/**
 * Portal connection form — login to ISY Portal (my.isy.io).
 *
 * Shows either a login form (disconnected) or a connected status banner.
 * One-time setup: enter portal email/password, credentials are stored
 * in localStorage and auto-restored on subsequent visits.
 */
import { useState } from 'react';
import { Cloud, CloudOff, Loader2, AlertCircle, LogOut } from 'lucide-react';
import { usePortalStore } from '@/stores/portal-store.ts';

export function PortalConnection() {
  const status = usePortalStore((s) => s.status);
  const credentials = usePortalStore((s) => s.credentials);
  const errorMessage = usePortalStore((s) => s.errorMessage);
  const connect = usePortalStore((s) => s.connect);
  const disconnect = usePortalStore((s) => s.disconnect);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    await connect(email, password);
  };

  // ── Connected state ──
  if (status === 'connected' && credentials) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/10">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Cloud size={16} className="text-green-600 dark:text-green-400" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                Connected to ISY Portal
              </p>
              <p className="text-xs text-green-600 dark:text-green-500">
                {credentials.email}
              </p>
            </div>
          </div>
          <button
            onClick={disconnect}
            className="flex items-center gap-1 rounded border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/30"
          >
            <LogOut size={12} /> Disconnect
          </button>
        </div>
      </div>
    );
  }

  // ── Disconnected / Error state — login form ──
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <CloudOff size={16} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Connect to ISY Portal
        </h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Sign in with your my.isy.io account to manage Google Home voice control
          directly from this app. Your portal credentials are stored in this browser's
          localStorage and auto-restored on future visits.
        </p>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Portal Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full max-w-sm rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Portal Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your my.isy.io password"
            autoComplete="current-password"
            className="w-full max-w-sm rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/10 dark:text-red-400">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={status === 'connecting' || !email || !password}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {status === 'connecting' ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Connecting...
            </>
          ) : (
            <>
              <Cloud size={14} /> Connect to Portal
            </>
          )}
        </button>
      </form>
    </div>
  );
}
