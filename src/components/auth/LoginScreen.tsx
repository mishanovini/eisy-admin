/**
 * Login screen with host auto-detection.
 * In production (deployed on eisy), auto-connects using same-origin.
 * In dev, prompts for host address.
 */
import { useState, useEffect } from 'react';
import { useConnectionStore } from '@/stores/connection-store.ts';
import { Logo } from '@/components/common/Logo.tsx';

export function LoginScreen() {
  const { connect, status, errorMessage } = useConnectionStore();
  const [host, setHost] = useState('192.168.4.123');
  const [port, setPort] = useState('8443');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [autoDetected, setAutoDetected] = useState(false);

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
    // In dev mode (localhost), use empty host so requests go through Vite proxy.
    // In production (deployed on eisy), use empty host for same-origin.
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    await connect({
      host: isDev ? '' : host,
      port: isDev ? 0 : parseInt(port, 10),
      protocol: 'https',
      username,
      password,
    });
  };

  if (status === 'connecting') {
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
          {errorMessage && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              {errorMessage}
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
            className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Connect
          </button>

          <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
            Default: admin / admin
          </p>
        </form>
      </div>
    </div>
  );
}
