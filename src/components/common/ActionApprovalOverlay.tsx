/**
 * Action Approval Overlay — renders pending approval cards for AI-initiated
 * device commands. Fixed position at top-center, below the TopBar.
 *
 * Each card shows:
 *  - Source badge (AI Chat / Self-Healing / Auto-Fix)
 *  - Description of the command
 *  - Technical detail
 *  - Countdown timer bar (60s → 0)
 *  - Deny (safe default) + Allow buttons
 */
import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, Bot, Wrench, Cpu } from 'lucide-react';
import { useActionApprovalStore, type PendingAction } from '@/stores/action-approval-store.ts';

const TIMEOUT_MS = 60_000;

/** Source label + color configuration */
const SOURCE_CONFIG: Record<PendingAction['source'], { label: string; color: string; Icon: typeof Bot }> = {
  'ai-chat':            { label: 'AI Chat',         color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',     Icon: Bot },
  'self-healing':       { label: 'Self-Healing',    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', Icon: Wrench },
  'auto-troubleshoot':  { label: 'Auto-Fix',        color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', Icon: Cpu },
};

export function ActionApprovalOverlay() {
  const pendingActions = useActionApprovalStore((s) => s.pendingActions);

  if (pendingActions.length === 0) return null;

  return (
    <div className="fixed left-1/2 top-14 z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
      {pendingActions.map((action) => (
        <ApprovalCard key={action.id} action={action} />
      ))}
    </div>
  );
}

function ApprovalCard({ action }: { action: PendingAction }) {
  const approve = useActionApprovalStore((s) => s.approve);
  const deny = useActionApprovalStore((s) => s.deny);
  const [remaining, setRemaining] = useState(TIMEOUT_MS);

  // Countdown timer — updates every 100ms for smooth progress bar
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - action.timestamp;
      const left = Math.max(0, TIMEOUT_MS - elapsed);
      setRemaining(left);
      if (left <= 0) clearInterval(interval);
    }, 100);
    return () => clearInterval(interval);
  }, [action.timestamp]);

  const handleApprove = useCallback(() => approve(action.id), [approve, action.id]);
  const handleDeny = useCallback(() => deny(action.id), [deny, action.id]);

  const progress = remaining / TIMEOUT_MS;
  const secondsLeft = Math.ceil(remaining / 1000);
  const config = SOURCE_CONFIG[action.source];
  const SourceIcon = config.Icon;

  return (
    <div className="overflow-hidden rounded-xl border border-amber-300 bg-white shadow-xl dark:border-amber-600 dark:bg-gray-800">
      {/* Countdown progress bar */}
      <div className="h-1 bg-gray-200 dark:bg-gray-700">
        <div
          className="h-full bg-amber-500 transition-all duration-100 dark:bg-amber-400"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="p-4">
        {/* Header: shield icon + source badge + timer */}
        <div className="mb-2 flex items-center gap-2">
          <ShieldAlert size={18} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.color}`}>
            <SourceIcon size={12} />
            {config.label}
          </span>
          <span className="ml-auto text-xs tabular-nums text-gray-400 dark:text-gray-500">
            {secondsLeft}s
          </span>
        </div>

        {/* Description */}
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {action.description}
        </p>

        {/* Technical detail */}
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {action.detail}
        </p>

        {/* Buttons */}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            onClick={handleDeny}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Deny
          </button>
          <button
            onClick={handleApprove}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
