/**
 * eisy port auto-discovery module (Node.js / Bun).
 *
 * Probes known ports on the eisy device to find where the REST API lives.
 * Used by vite.config.ts (dev startup) and deploy.ts (deployment).
 */
import http from 'http';
import https from 'https';

// ─── Types ──────────────────────────────────────────────────────

export interface ProbeResult {
  protocol: 'http' | 'https';
  port: number;
  status: 'ok' | 'auth_failed' | 'not_eisy' | 'timeout' | 'error';
  httpCode?: number;
  timeMs: number;
  error?: string;
}

export interface DiscoveryResult {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  /** Whether the REST API was found on the returned port */
  found: boolean;
  probeResults: ProbeResult[];
}

export interface DiscoveryOptions {
  host: string;
  username: string;
  password: string;
  preferredPort?: number;
  preferredProtocol?: 'http' | 'https';
  /** Timeout per probe in ms (default: 3000) */
  timeout?: number;
}

// ─── Port Lists ─────────────────────────────────────────────────

const KNOWN_PORTS = [8443, 8080, 443, 80];
const EXTENDED_PORTS = [3000, 5000, 8000, 8888, 9443];

// ─── Probe Logic ────────────────────────────────────────────────

function probePort(
  host: string,
  port: number,
  protocol: 'http' | 'https',
  username: string,
  password: string,
  timeout: number,
): Promise<ProbeResult> {
  const start = Date.now();
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const mod = protocol === 'https' ? https : http;

  return new Promise((resolve) => {
    let resolved = false;
    const done = (result: ProbeResult): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(hardTimer);
      req.destroy();
      resolve(result);
    };

    // Hard timeout — covers connection establishment, TLS handshake, and response.
    // Node's built-in `timeout` only fires after socket assignment, missing
    // cases where the port silently drops packets.
    const hardTimer = setTimeout(() => {
      done({ protocol, port, status: 'timeout', timeMs: Date.now() - start });
    }, timeout);

    const req = mod.request(
      {
        hostname: host,
        port,
        path: '/rest/nodes',
        method: 'GET',
        headers: { Authorization: `Basic ${auth}` },
        timeout,
        ...(protocol === 'https' ? { rejectUnauthorized: false } : {}),
      } as http.RequestOptions & { rejectUnauthorized?: boolean },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          // Only need the first few KB to confirm it's eisy
          if (body.length > 4096) {
            const httpCode = res.statusCode ?? 0;
            if (httpCode === 200 && body.includes('<nodes')) {
              done({ protocol, port, status: 'ok', httpCode, timeMs: Date.now() - start });
            } else {
              done({ protocol, port, status: 'not_eisy', httpCode, timeMs: Date.now() - start });
            }
          }
        });
        res.on('end', () => {
          const timeMs = Date.now() - start;
          const httpCode = res.statusCode ?? 0;

          if (httpCode === 401) {
            done({ protocol, port, status: 'auth_failed', httpCode, timeMs });
          } else if (httpCode === 200 && body.includes('<nodes')) {
            done({ protocol, port, status: 'ok', httpCode, timeMs });
          } else {
            done({ protocol, port, status: 'not_eisy', httpCode, timeMs });
          }
        });
      },
    );

    req.on('timeout', () => {
      done({ protocol, port, status: 'timeout', timeMs: Date.now() - start });
    });

    req.on('error', (err: Error) => {
      done({
        protocol,
        port,
        status: 'error',
        timeMs: Date.now() - start,
        error: err.message,
      });
    });

    req.end();
  });
}

// ─── Discovery ──────────────────────────────────────────────────

/**
 * Build ordered list of [protocol, port] candidates.
 * Preferred combo first, then known ports, then extended ports.
 */
function buildCandidates(
  preferredPort?: number,
  preferredProtocol?: 'http' | 'https',
): Array<[protocol: 'http' | 'https', port: number]> {
  const seen = new Set<string>();
  const candidates: Array<[protocol: 'http' | 'https', port: number]> = [];

  const add = (protocol: 'http' | 'https', port: number): void => {
    const key = `${protocol}:${port}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push([protocol, port]);
    }
  };

  // Preferred combo first
  if (preferredPort != null) {
    if (preferredProtocol) {
      add(preferredProtocol, preferredPort);
      // Also try the opposite protocol for the preferred port
      add(preferredProtocol === 'https' ? 'http' : 'https', preferredPort);
    } else {
      add('https', preferredPort);
      add('http', preferredPort);
    }
  }

  // Known ports (HTTPS first, then HTTP for each)
  for (const port of KNOWN_PORTS) {
    add('https', port);
    add('http', port);
  }

  // Extended ports
  for (const port of EXTENDED_PORTS) {
    add('https', port);
    add('http', port);
  }

  return candidates;
}

/**
 * Discover the eisy REST API by probing known ports.
 *
 * Always returns probe results for diagnostics. Check `found` to see if discovery succeeded.
 */
export async function discoverEisy(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { host, username, password, preferredPort, preferredProtocol, timeout = 3000 } = options;
  const candidates = buildCandidates(preferredPort, preferredProtocol);
  const probeResults: ProbeResult[] = [];

  // Try known ports first (sequential to short-circuit fast)
  const knownCount = candidates.length - EXTENDED_PORTS.length * 2;
  for (let i = 0; i < Math.min(knownCount, candidates.length); i++) {
    const [protocol, port] = candidates[i]!;
    const result = await probePort(host, port, protocol, username, password, timeout);
    probeResults.push(result);
    if (result.status === 'ok') {
      return { host, port, protocol, found: true, probeResults };
    }
  }

  // Known ports failed — try extended ports
  for (let i = knownCount; i < candidates.length; i++) {
    const [protocol, port] = candidates[i]!;
    const result = await probePort(host, port, protocol, username, password, timeout);
    probeResults.push(result);
    if (result.status === 'ok') {
      return { host, port, protocol, found: true, probeResults };
    }
  }

  // Nothing found — return with found: false and all probe results
  return { host, port: preferredPort ?? 8443, protocol: preferredProtocol ?? 'https', found: false, probeResults };
}

/**
 * Format discovery results as a diagnostic log string.
 */
export function formatDiagnostics(host: string, results: ProbeResult[]): string {
  const lines: string[] = [
    `[eisy] Could not find REST API on ${host}`,
    '[eisy] Probe results:',
  ];

  for (const r of results) {
    const statusIcon =
      r.status === 'ok' ? '✓' :
      r.status === 'auth_failed' ? '🔑' :
      r.status === 'timeout' ? '⏱' : '✗';
    const detail = r.error ? ` (${r.error})` : r.httpCode ? ` (HTTP ${r.httpCode})` : '';
    lines.push(`  ${statusIcon} ${r.protocol}://${host}:${r.port} → ${r.status}${detail} [${r.timeMs}ms]`);
  }

  lines.push('');
  lines.push('[eisy] Troubleshooting:');
  lines.push('  1. Is the eisy device powered on?');
  lines.push('  2. Is this machine on the same network as the eisy?');
  lines.push(`  3. Can you ping ${host}?`);
  lines.push('  4. Has the eisy IP address changed? Check your router\'s DHCP leases.');
  return lines.join('\n');
}
