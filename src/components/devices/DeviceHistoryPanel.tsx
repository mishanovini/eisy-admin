/**
 * Device History Panel — shows recent events for a device with source attribution.
 *
 * Displays WHO caused each state change: program, scene, manual, AI, etc.
 * Queries IndexedDB for persisted events via the standalone queryLogs() function.
 */
import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, History } from 'lucide-react';
import { queryLogs, type LogEntry } from '@/stores/log-store.ts';
import { resolveSourceName } from '@/utils/source-attribution.ts';

interface DeviceHistoryPanelProps {
  address: string;
}

// ─── Source Badge Colors ─────────────────────────────────────────────────────

function getSourceColor(source: string): string {
  if (source.startsWith('program:')) return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  if (source.startsWith('scene:')) return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
  if (source === 'manual') return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  if (source === 'ai-chat') return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';
  if (source === 'portal') return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
  if (source === 'device') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
}

// ─── Relative Time Formatting ────────────────────────────────────────────────

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DeviceHistoryPanel({ address }: DeviceHistoryPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await queryLogs({
        device: String(address),
        limit: 20,
      });
      setEntries(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200"
          aria-expanded={expanded}
          aria-label="Recent activity"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <History size={14} />
          Recent Activity
          {entries.length > 0 && (
            <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">
              ({entries.length})
            </span>
          )}
        </button>
        <button
          onClick={loadHistory}
          className="ml-auto rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          title="Refresh history"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {expanded && (
        <div className="space-y-1">
          {error && (
            <p className="py-3 text-center text-xs text-red-500 dark:text-red-400">
              Failed to load history — {error}
            </p>
          )}

          {entries.length === 0 && !loading && !error && (
            <p className="py-3 text-center text-xs text-gray-400 dark:text-gray-500">
              No recent activity recorded for this device.
            </p>
          )}

          {entries.map((entry) => (
            <div
              key={entry.id ?? entry.timestamp}
              className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-1.5 dark:border-gray-800 dark:bg-gray-900/50"
            >
              {/* Time */}
              <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500" title={new Date(entry.timestamp).toLocaleString()}>
                {relativeTime(entry.timestamp)}
              </span>

              {/* Action */}
              <span className="min-w-0 truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                {entry.action}
              </span>

              {/* Source badge */}
              <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${getSourceColor(entry.source)}`}>
                {resolveSourceName(entry.source)}
              </span>

              {/* Failure indicator */}
              {entry.result === 'fail' && (
                <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
                  Failed
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
