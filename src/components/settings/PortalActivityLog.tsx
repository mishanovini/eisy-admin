/**
 * Portal activity log — shows recent portal API interactions.
 *
 * Filters the main log store to category='portal' and displays
 * a compact, collapsible, scrollable history of all portal actions.
 * Collapsed by default to save screen space for spoken entries.
 */
import { useState, useEffect } from 'react';
import { Clock, Check, X, Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { useLogStore, type LogEntry } from '@/stores/log-store.ts';

export function PortalActivityLog() {
  const entries = useLogStore((s) => s.entries);
  const loadEntries = useLogStore((s) => s.loadEntries);
  const [expanded, setExpanded] = useState(false);

  // Load portal entries on mount
  useEffect(() => {
    loadEntries({ category: 'portal', limit: 50 });
  }, [loadEntries]);

  // Filter to portal entries from the in-memory cache
  const portalEntries = entries.filter((e) => e.category === 'portal');

  if (portalEntries.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Activity size={14} className="text-gray-400" />
          <span className="text-xs text-gray-400">
            No portal activity yet
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown size={14} className="text-gray-400" />
          ) : (
            <ChevronRight size={14} className="text-gray-400" />
          )}
          <Activity size={14} className="text-indigo-500" />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Portal Activity
          </span>
          <span className="text-xs text-gray-400">({portalEntries.length})</span>
        </div>
        <span className="text-xs text-gray-400">{expanded ? 'Hide' : 'Show'}</span>
      </button>

      {expanded && (
        <div className="max-h-40 overflow-y-auto border-t border-gray-100 dark:border-gray-800">
          {portalEntries.slice(0, 30).map((entry, i) => (
            <LogRow key={entry.id ?? i} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const time = new Date(entry.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = isToday(time) ? timeStr : `${time.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;

  return (
    <div className="flex items-center gap-3 border-b border-gray-50 px-4 py-1.5 last:border-0 dark:border-gray-800/50">
      {entry.result === 'success' ? (
        <Check size={12} className="shrink-0 text-green-500" />
      ) : (
        <X size={12} className="shrink-0 text-red-500" />
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-300">
        {entry.action}
        {entry.detail && (
          <span className="ml-1 text-gray-400"> — {entry.detail}</span>
        )}
      </span>
      <span className="shrink-0 text-[10px] text-gray-400">
        <Clock size={10} className="mr-0.5 inline" />
        {dateStr}
      </span>
    </div>
  );
}

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}
