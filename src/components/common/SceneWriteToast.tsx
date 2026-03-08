/**
 * Scene Write Toast — shows progress of scene property writes (OL/RR)
 * being sent to physical Insteon devices via the eisy.
 *
 * Reads from the scene-write-store and displays:
 * - Active write: spinner + "Setting [Device] → [Value] in [Scene]"
 * - Pending writes: count of queued operations
 * - Success: brief green flash before auto-dismiss (3s)
 * - Error: red with message, stays until manually dismissed
 *
 * Positioned in bottom-right, above the KBCaptureToast.
 */
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  useSceneWriteStore,
  describeWrite,
  type SceneWriteEntry,
} from '@/stores/scene-write-store.ts';

export function SceneWriteToast() {
  const entries = useSceneWriteStore((s) => s.entries);
  const dismiss = useSceneWriteStore((s) => s.dismiss);

  // Nothing to show
  if (entries.length === 0) return null;

  const writing = entries.filter((e) => e.status === 'writing');
  const pending = entries.filter((e) => e.status === 'pending');
  const successes = entries.filter((e) => e.status === 'success');
  const errors = entries.filter((e) => e.status === 'error');

  return (
    <div className="fixed bottom-28 right-4 z-50 flex flex-col gap-2">
      {/* Active + pending summary toast */}
      {(writing.length > 0 || pending.length > 0) && (
        <div className="flex w-80 items-start gap-2.5 rounded-lg border border-purple-200 bg-white px-3 py-2.5 shadow-lg dark:border-purple-800 dark:bg-gray-800">
          <div className="mt-0.5 flex-shrink-0">
            <Loader2 size={16} className="animate-spin text-purple-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-500 dark:text-purple-400">
              Writing to Devices
            </p>
            {writing.map((entry) => (
              <WriteEntryLine key={entry.id} entry={entry} />
            ))}
            {pending.length > 0 && (
              <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                +{pending.length} more queued
              </p>
            )}
          </div>
        </div>
      )}

      {/* Success toasts (brief — auto-dismissed after 3s by the store) */}
      {successes.map((entry) => (
        <div
          key={entry.id}
          className="flex w-80 items-start gap-2.5 rounded-lg border border-green-200 bg-white px-3 py-2.5 shadow-lg dark:border-green-800 dark:bg-gray-800"
        >
          <CheckCircle size={16} className="mt-0.5 flex-shrink-0 text-green-500" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">
              Updated
            </p>
            <WriteEntryLine entry={entry} />
          </div>
          <button
            onClick={() => dismiss(entry.id)}
            className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      ))}

      {/* Error toasts (stay until dismissed) */}
      {errors.map((entry) => (
        <div
          key={entry.id}
          className="flex w-80 items-start gap-2.5 rounded-lg border border-red-200 bg-white px-3 py-2.5 shadow-lg dark:border-red-800 dark:bg-gray-800"
        >
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 dark:text-red-400">
              Write Failed
            </p>
            <WriteEntryLine entry={entry} />
            {entry.error && (
              <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">
                {entry.error}
              </p>
            )}
          </div>
          <button
            onClick={() => dismiss(entry.id)}
            className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Single line describing a write entry */
function WriteEntryLine({ entry }: { entry: SceneWriteEntry }) {
  return (
    <p className="mt-0.5 text-xs text-gray-700 dark:text-gray-300">
      <span className="font-medium">{entry.memberName}</span>
      <span className="mx-1 text-gray-400">→</span>
      <span>{describeWrite(entry)}</span>
      <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">
        in {entry.sceneName}
      </span>
    </p>
  );
}
