/**
 * Status bar — connection indicator, self-healing status, notifications.
 */
import { Wifi, WifiOff, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useConnectionStore } from '@/stores/connection-store.ts';

export function StatusBar() {
  const { status, host, errorMessage } = useConnectionStore();

  const statusIcon = {
    connected: <Wifi size={14} className="text-green-500" />,
    connecting: <Wifi size={14} className="animate-pulse text-amber-500" />,
    disconnected: <WifiOff size={14} className="text-gray-400" />,
    error: <AlertTriangle size={14} className="text-red-500" />,
  }[status];

  const statusText = {
    connected: `Connected${host ? ` to ${host}` : ''}`,
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
    error: errorMessage ?? 'Connection error',
  }[status];

  return (
    <footer className="flex h-7 items-center justify-between border-t border-gray-200 bg-gray-50 px-4 text-xs dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center gap-2">
        {statusIcon}
        <span className="text-gray-500 dark:text-gray-400">{statusText}</span>
      </div>
      <div className="flex items-center gap-2">
        {status === 'connected' && (
          <>
            <CheckCircle2 size={12} className="text-green-500" />
            <span className="text-gray-400 dark:text-gray-500">Systems normal</span>
          </>
        )}
      </div>
    </footer>
  );
}
