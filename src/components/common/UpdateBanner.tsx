/**
 * UpdateBanner — sticky notification when a new version is available.
 * Shows release notes preview, "Update Now" button, and upload progress.
 * Appears below the app header when useUpdateStore detects a newer release.
 */
import { useState } from 'react';
import { Download, X, ChevronDown, ChevronUp, Loader2, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useUpdateStore } from '@/services/update-service.ts';
import { APP_VERSION } from '@/utils/version.ts';

export function UpdateBanner() {
  const latestVersion = useUpdateStore((s) => s.latestVersion);
  const releaseNotes = useUpdateStore((s) => s.releaseNotes);
  const releaseUrl = useUpdateStore((s) => s.releaseUrl);
  const assetUrl = useUpdateStore((s) => s.assetUrl);
  const updating = useUpdateStore((s) => s.updating);
  const updateProgress = useUpdateStore((s) => s.updateProgress);
  const error = useUpdateStore((s) => s.error);
  const isAvailable = useUpdateStore((s) => s.isUpdateAvailable);
  const applyUpdate = useUpdateStore((s) => s.applyUpdate);
  const dismissUpdate = useUpdateStore((s) => s.dismissUpdate);
  const [showNotes, setShowNotes] = useState(false);

  if (!isAvailable() || !latestVersion) return null;

  const progressPercent = updateProgress
    ? Math.round((updateProgress.current / updateProgress.total) * 100)
    : 0;

  return (
    <div className="border-b border-blue-200 bg-blue-50 px-4 py-2.5 dark:border-blue-800 dark:bg-blue-950/50">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-lg">🎉</span>
          <span className="font-medium text-blue-900 dark:text-blue-100">
            Super eisy v{latestVersion} is available!
          </span>
          <span className="text-blue-600 dark:text-blue-400">
            (current: v{APP_VERSION})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Release notes toggle */}
          {releaseNotes && (
            <button
              onClick={() => setShowNotes(!showNotes)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/50"
            >
              {showNotes ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Notes
            </button>
          )}

          {/* GitHub release link */}
          {releaseUrl && (
            <a
              href={releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/50"
            >
              <ExternalLink size={12} />
              View
            </a>
          )}

          {/* Update button */}
          {assetUrl && !updating && (
            <button
              onClick={applyUpdate}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              <Download size={12} />
              Update Now
            </button>
          )}

          {/* Updating state */}
          {updating && updateProgress && (
            <div className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-blue-600 dark:text-blue-400" />
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-blue-200 dark:bg-blue-800">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-300 dark:bg-blue-400"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-xs text-blue-700 dark:text-blue-300">
                  {updateProgress.current}/{updateProgress.total}
                </span>
              </div>
            </div>
          )}

          {/* Update complete (brief flash before reload) */}
          {!updating && updateProgress && updateProgress.current === updateProgress.total && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
              <CheckCircle2 size={12} /> Updated! Reloading...
            </span>
          )}

          {/* Dismiss button */}
          {!updating && (
            <button
              onClick={dismissUpdate}
              className="rounded p-1 text-blue-400 hover:bg-blue-100 hover:text-blue-600 dark:text-blue-500 dark:hover:bg-blue-900/50 dark:hover:text-blue-300"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          Update error: {error}
        </p>
      )}

      {/* Release notes expanded */}
      {showNotes && releaseNotes && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded border border-blue-200 bg-white p-3 text-xs text-gray-700 dark:border-blue-800 dark:bg-gray-900 dark:text-gray-300">
          <pre className="whitespace-pre-wrap font-sans">{releaseNotes}</pre>
        </div>
      )}
    </div>
  );
}
