import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { WebSocket as NodeWS, WebSocketServer } from 'ws';
import { discoverEisy, formatDiagnostics } from './scripts/discover-eisy.ts';
import { readEnvFile, updateEnvFile } from './scripts/update-env.ts';

/**
 * Build plugin that renames index.html → index.htm in the output.
 * The eisy device requires .htm extension due to a MIME type bug,
 * but Vite's dev server only processes .html natively.
 */
function renameHtmPlugin(): Plugin {
  return {
    name: 'rename-htm',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist');
      const htmlPath = path.join(outDir, 'index.html');
      const htmPath = path.join(outDir, 'index.htm');
      if (fs.existsSync(htmlPath)) {
        fs.renameSync(htmlPath, htmPath);
        console.log('Renamed index.html → index.htm for eisy deployment');
      }
    },
  };
}

/**
 * WebSocket proxy plugin for the eisy /rest/subscribe endpoint.
 *
 * Vite's built-in `ws: true` proxy fails with self-signed certs because
 * http-proxy's TLS handshake rejects them despite `secure: false`.
 * This plugin manually intercepts WebSocket upgrade requests on /rest/subscribe
 * and tunnels them to the eisy using the `ws` package with
 * `rejectUnauthorized: false` — giving us full control over the TLS connection.
 *
 * Architecture: Accept client WebSocket FIRST (synchronously during upgrade),
 * then connect upstream. Buffer client messages until upstream is ready.
 * This prevents crashes from stale sockets during async upstream connection.
 */
function wsProxyPlugin(
  eisyHost: string,
  eisyPort: number,
  eisyProtocol: 'http' | 'https',
  eisyUser: string,
  eisyPass: string,
): Plugin {
  const EISY_AUTH = 'Basic ' + Buffer.from(`${eisyUser}:${eisyPass}`).toString('base64');
  const wsScheme = eisyProtocol === 'https' ? 'wss' : 'ws';

  return {
    name: 'eisy-ws-proxy',
    configureServer(server) {
      // Create a single WebSocket server for accepting client connections
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on('upgrade', (req, socket, head) => {
        // Only proxy /rest/subscribe WebSocket requests
        if (!req.url?.startsWith('/rest/subscribe')) return;

        const protocol = req.headers['sec-websocket-protocol'] || '';
        const upstreamUrl = `${wsScheme}://${eisyHost}:${eisyPort}${req.url}`;

        console.log(`[WS Proxy] Upgrading ${req.url} → ${upstreamUrl} (protocol: ${protocol})`);

        // Step 1: Accept the client connection IMMEDIATELY (synchronous)
        try {
          wss.handleUpgrade(req, socket, head, (clientWs) => {
            console.log('[WS Proxy] Client accepted, connecting upstream...');

            // Buffer messages from client until upstream is ready
            const bufferedMessages: Buffer[] = [];
            let upstreamReady = false;

            // Step 2: Connect to eisy upstream (async)
            const upstream = new NodeWS(upstreamUrl, protocol ? protocol.split(',').map((s: string) => s.trim()) : [], {
              agent: eisyProtocol === 'https' ? new https.Agent({ rejectUnauthorized: false }) : undefined,
              headers: {
                Authorization: req.headers.authorization || EISY_AUTH,
              },
            });

            // Client → upstream relay
            clientWs.on('message', (data) => {
              if (upstreamReady && upstream.readyState === NodeWS.OPEN) {
                upstream.send(data);
              } else {
                bufferedMessages.push(Buffer.from(data as Buffer));
              }
            });

            clientWs.on('close', () => {
              console.log('[WS Proxy] Client disconnected');
              upstream.close();
            });

            clientWs.on('error', (err) => {
              console.error('[WS Proxy] Client error:', (err as Error).message);
              upstream.close();
            });

            // Upstream events
            upstream.on('open', () => {
              console.log('[WS Proxy] Upstream connected');
              upstreamReady = true;

              // Flush buffered messages
              for (const msg of bufferedMessages) {
                upstream.send(msg);
              }
              bufferedMessages.length = 0;
            });

            upstream.on('message', (data) => {
              if (clientWs.readyState === NodeWS.OPEN) {
                clientWs.send(data);
              }
            });

            upstream.on('close', () => {
              console.log('[WS Proxy] Upstream disconnected');
              if (clientWs.readyState === NodeWS.OPEN) clientWs.close();
            });

            upstream.on('error', (err) => {
              console.error('[WS Proxy] Upstream error:', (err as Error).message);
              if (clientWs.readyState === NodeWS.OPEN) clientWs.close();
            });
          });
        } catch (err) {
          console.error('[WS Proxy] handleUpgrade failed:', (err as Error).message);
          socket.destroy();
        }
      });
    },
  };
}

// Read version from package.json at build time
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(async () => {
  // ─── Load .env and discover eisy ────────────────────────────────

  const envPath = path.resolve(__dirname, '.env');
  const envVars = readEnvFile(envPath);

  const EISY_HOST = envVars.VITE_EISY_HOST || '192.168.4.123';
  const EISY_PORT = parseInt(envVars.VITE_EISY_PORT || '8443', 10);
  const EISY_PROTOCOL = (envVars.VITE_EISY_PROTOCOL || 'https') as 'http' | 'https';
  const EISY_USER = envVars.VITE_EISY_USER || 'admin';
  const EISY_PASS = envVars.VITE_EISY_PASS || 'admin';

  console.log(`[eisy] Probing ${EISY_HOST} for REST API (preferred: ${EISY_PROTOCOL}://${EISY_HOST}:${EISY_PORT})...`);

  const discovery = await discoverEisy({
    host: EISY_HOST,
    username: EISY_USER,
    password: EISY_PASS,
    preferredPort: EISY_PORT,
    preferredProtocol: EISY_PROTOCOL,
    timeout: 3000,
  });

  let activePort = EISY_PORT;
  let activeProtocol = EISY_PROTOCOL;

  if (discovery.found) {
    activePort = discovery.port;
    activeProtocol = discovery.protocol;
    console.log(`[eisy] ✓ REST API found at ${activeProtocol}://${EISY_HOST}:${activePort}`);

    // Persist to .env if port or protocol changed
    const envUpdate = updateEnvFile(envPath, {
      VITE_EISY_HOST: EISY_HOST,
      VITE_EISY_PORT: String(activePort),
      VITE_EISY_PROTOCOL: activeProtocol,
      VITE_EISY_USER: EISY_USER,
      VITE_EISY_PASS: EISY_PASS,
    });

    if (envUpdate.changed) {
      console.log('[eisy] Updated .env with discovered settings:');
      for (const [key, val] of Object.entries(envUpdate.newValues)) {
        console.log(`  ${key}: ${envUpdate.previousValues[key] || '(unset)'} → ${val}`);
      }
    }
  } else {
    console.error(formatDiagnostics(EISY_HOST, discovery.probeResults));
    console.error(`[eisy] Falling back to .env values: ${EISY_PROTOCOL}://${EISY_HOST}:${EISY_PORT}`);
    console.error('[eisy] Dev server will start, but eisy proxy may not work.\n');
  }

  const target = `${activeProtocol}://${EISY_HOST}:${activePort}`;

  // ─── Vite Config ────────────────────────────────────────────────

  return {
    plugins: [
      react(),
      tailwindcss(),
      renameHtmPlugin(),
      wsProxyPlugin(EISY_HOST, activePort, activeProtocol, EISY_USER, EISY_PASS),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    base: '/WEB/console/',
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/rest': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/services': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/program': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/file': {
          target,
          changeOrigin: true,
          secure: false,
        },
        // OpenAI API proxy — OpenAI blocks CORS on /v1/chat/completions from browsers.
        // The models endpoint works, but chat/completions doesn't send CORS headers.
        '/openai-api': {
          target: 'https://api.openai.com',
          changeOrigin: true,
          secure: true,
          rewrite: (p: string) => p.replace(/^\/openai-api/, ''),
        },
        // ISY Portal proxy — avoids CORS preflight failure (my.isy.io OPTIONS returns 500)
        '/portal-api': {
          target: 'https://my.isy.io',
          changeOrigin: true,
          secure: true,
          rewrite: (p: string) => p.replace(/^\/portal-api/, '/api'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              // Strip browser-injected headers that confuse the portal's Express server.
              // The portal sees Host: my.isy.io but Origin: http://127.0.0.1 — this
              // contradictory combination causes their middleware to return 500.
              proxyReq.removeHeader('origin');
              proxyReq.removeHeader('referer');
              proxyReq.removeHeader('sec-ch-ua');
              proxyReq.removeHeader('sec-ch-ua-mobile');
              proxyReq.removeHeader('sec-ch-ua-platform');
              proxyReq.removeHeader('sec-fetch-site');
              proxyReq.removeHeader('sec-fetch-mode');
              proxyReq.removeHeader('sec-fetch-dest');
            });
            // Debug: log spoken/rooms API responses
            proxy.on('proxyRes', (proxyRes, req) => {
              if (req.url?.includes('/voice/') || req.url?.includes('/login')) {
                let body = '';
                proxyRes.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                proxyRes.on('end', () => {
                  console.log(`[Portal Proxy] ${req.method} ${req.url} → ${proxyRes.statusCode}: ${body.substring(0, 300)}`);
                });
              }
            });
            proxy.on('error', (err, req) => {
              console.error(`[Portal Proxy] Error for ${req.method} ${req.url}:`, err.message);
            });
          },
        },
      },
    },
  };
});
