/**
 * Login screen with host auto-detection and port discovery.
 * In production (deployed on eisy), auto-connects using same-origin.
 * In dev, prompts for host address (Vite proxy handles discovery).
 * When a manual host fails, auto-discovers the correct port.
 */
import { useState, useEffect } from 'react';
import { useConnectionStore } from '@/stores/connection-store.ts';
import { Logo } from '@/components/common/Logo.tsx';
import { discoverEisyBrowser } from '@/utils/discover-eisy.ts';
import type { BrowserProbeResult } from '@/utils/discover-eisy.ts';

export function LoginScreen() {
  const { connect, status, errorMessage } = useConnectionStore();
  const [host, setHost] = useState(import.meta.env.VITE_EISY_HOST || '192.168.4.123');
  const [port, setPort] = useState(import.meta.env.VITE_EISY_PORT || '8443');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [autoDetected, setAutoDetected] = useState(false);

  // Discovery state
  const [discovering, setDiscovering] = useState(false);
  const [probeResults, setProbeResults] = useState<BrowserProbeResult[] | null>(null);
  const [discoveryDone, setDiscoveryDone] = useState(false);

  // Auto-connect: in production (on eisy), try same-origin.
  // In dev, skip auto-connect — user clicks Connect to use Vite proxy.
  useEffect(() => {
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isDev) return; // Dev mode: manual connect only (via Vite proxy)

    const tryAutoConnect = async () => {
      setHost('');
      setPort(window.location.port || '8443');
      setAutoDetected(true);
      await connect({
        host: '',
        port: parseInt(window.location.port || '8443', 10),
        protocol: window.location.protocol === 'https:' ? 'https' : 'http',
        username: 'admin',
        password: 'admin',
      });
    };
    tryAutoConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProbeResults(null);
    setDiscoveryDone(false);

    // In dev mode (localhost), use empty host so requests go through Vite proxy.
    // In production (deployed on eisy), use empty host for same-origin.
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const success = await connect({
      host: isDev ? '' : host,
      port: isDev ? 0 : parseInt(port, 10),
      protocol: isDev ? 'http' : 'https',
      username,
      password,
    });

    // If connection failed and we have a manual host, try discovering the correct port
    if (!success && !isDev && host) {
      setDiscovering(true);
      setProbeResults([]);

      const result = await discoverEisyBrowser({
        host,
        username,
        password,
        preferredPort: parseInt(port, 10),
        timeout: 3000,
        onProgress: (probe) => {
          setProbeResults((prev) => [...(prev ?? []), probe]);
        },
      });

      setDiscovering(false);
      setDiscoveryDone(true);

      if (result) {
        // Found it — update form and connect
        setPort(String(result.port));
        await connect({
          host,
          port: result.port,
          protocol: result.protocol,
          username,
          password,
        });
      }
    }
  };

  if (status === 'connecting' && !discovering) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Connecting to eisy{host ? ` at ${host}` : ''}...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 flex justify-center">
            <Logo size={64} />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Super eisy</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Connect to your Universal Devices eisy
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900"
        >
          {errorMessage && !discovering && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              {errorMessage}
            </div>
          )}

          {/* Discovery progress */}
          {discovering && (
            <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/30">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                Scanning for eisy REST API...
              </div>
              {probeResults && probeResults.length > 0 && (
                <ProbeResultsTable results={probeResults} />
              )}
            </div>
          )}

          {/* Discovery results (after completion, no success) */}
          {discoveryDone && !discovering && status === 'error' && probeResults && probeResults.length > 0 && (
            <div className="mb-4 rounded border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/30">
              <p className="mb-2 text-sm font-medium text-yellow-700 dark:text-yellow-400">
                Could not find eisy REST API on {host}
              </p>
              <ProbeResultsTable results={probeResults} />
              <p className="mt-2 text-xs text-yellow-600 dark:text-yellow-500">
                Check that the eisy is powered on and reachable. For HTTPS ports, you may need to
                visit the eisy URL directly in your browser first to accept the self-signed certificate.
              </p>
            </div>
          )}

          {!autoDetected && (
            <div className="mb-4">
              <label htmlFor="host" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Host Address
              </label>
              <input
                id="host"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.x.x"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          )}

          {!autoDetected && (
            <div className="mb-4">
              <label htmlFor="port" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Port
              </label>
              <input
                id="port"
                type="text"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="username" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          <div className="mb-6">
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          <button
            type="submit"
            disabled={discovering}
            className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {discovering ? 'Scanning...' : 'Connect'}
          </button>

          <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
            Default: admin / admin
          </p>
        </form>
      </div>
    </div>
  );
}

// ─── Probe Results Table ────────────────────────────────────────

function ProbeResultsTable({ results }: { results: BrowserProbeResult[] }) {
  return (
    <div className="max-h-32 overflow-y-auto text-xs font-mono">
      <table className="w-full">
        <tbody>
          {results.map((r, i) => (
            <tr key={i} className="border-b border-gray-200/50 dark:border-gray-700/50 last:border-0">
              <td className="py-0.5 pr-2">
                {r.status === 'ok' ? '✓' : r.status === 'timeout' ? '⏱' : '✗'}
              </td>
              <td className="py-0.5 pr-2 text-gray-600 dark:text-gray-400">
                {r.protocol}://{r.port}
              </td>
              <td className="py-0.5 pr-2">
                <span className={
                  r.status === 'ok' ? 'text-green-600 dark:text-green-400' :
                  r.status === 'auth_failed' ? 'text-yellow-600 dark:text-yellow-400' :
                  'text-gray-500 dark:text-gray-500'
                }>
                  {r.status === 'ok' ? 'Found' :
                   r.status === 'auth_failed' ? 'Auth failed' :
                   r.status === 'timeout' ? 'Timeout' :
                   r.status === 'not_eisy' ? 'Not eisy' :
                   r.error ?? 'Error'}
                </span>
              </td>
              <td className="py-0.5 text-right text-gray-400 dark:text-gray-600">
                {r.timeMs}ms
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
