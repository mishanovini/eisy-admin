/**
 * KB Capture Toast — severity-aware notification toasts that slide in
 * from the bottom-right when the KB capture system fires events.
 *
 * Severity colors:
 *  - info (blue) — new KB entry, AI learning
 *  - warning (amber) — investigation in progress, non-critical issue
 *  - error (red) — action needed, fix failed
 *  - resolved (green) — issue auto-fixed
 *  - bug-report (purple) — app-level bug detected
 *
 * Auto-dismisses after 5s. Clicking navigates to Knowledge Base.
 * Multiple toasts stack (max 3 visible).
 */
import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Bug,
  X,
} from 'lucide-react';
import {
  useKBCaptureStore,
  type KBCaptureNotification,
  type NotificationSeverity,
} from '@/stores/kb-capture-store.ts';

/** Severity → icon + color mapping */
function getSeverityStyle(severity: NotificationSeverity) {
  switch (severity) {
    case 'info':
      return {
        Icon: BookOpen,
        iconColor: 'text-blue-500',
        border: 'border-blue-200 hover:border-blue-300 dark:border-blue-800 dark:hover:border-blue-700',
        label: 'Knowledge Base',
        labelColor: 'text-blue-500 dark:text-blue-400',
      };
    case 'warning':
      return {
        Icon: AlertTriangle,
        iconColor: 'text-amber-500',
        border: 'border-amber-200 hover:border-amber-300 dark:border-amber-800 dark:hover:border-amber-700',
        label: 'Investigating',
        labelColor: 'text-amber-500 dark:text-amber-400',
      };
    case 'error':
      return {
        Icon: AlertCircle,
        iconColor: 'text-red-500',
        border: 'border-red-200 hover:border-red-300 dark:border-red-800 dark:hover:border-red-700',
        label: 'Action Needed',
        labelColor: 'text-red-500 dark:text-red-400',
      };
    case 'resolved':
      return {
        Icon: CheckCircle,
        iconColor: 'text-green-500',
        border: 'border-green-200 hover:border-green-300 dark:border-green-800 dark:hover:border-green-700',
        label: 'Resolved',
        labelColor: 'text-green-600 dark:text-green-400',
      };
    case 'bug-report':
      return {
        Icon: Bug,
        iconColor: 'text-purple-500',
        border: 'border-purple-200 hover:border-purple-300 dark:border-purple-800 dark:hover:border-purple-700',
        label: 'Bug Detected',
        labelColor: 'text-purple-500 dark:text-purple-400',
      };
  }
}

export function KBCaptureToast() {
  const notifications = useKBCaptureStore((s) => s.notifications);
  const dismiss = useKBCaptureStore((s) => s.dismissNotification);
  const navigate = useNavigate();

  // Auto-dismiss after 5 seconds (only undismissed, fresh notifications)
  useEffect(() => {
    const fresh = notifications.filter(
      (n) => !n.dismissed && Date.now() - n.timestamp < 6000,
    );
    if (fresh.length === 0) return;

    const timers = fresh.map((n) => {
      const age = Date.now() - n.timestamp;
      const remaining = Math.max(5000 - age, 0);
      return setTimeout(() => dismiss(n.id), remaining);
    });

    return () => timers.forEach(clearTimeout);
  }, [notifications, dismiss]);

  const handleClick = useCallback(
    (notification: KBCaptureNotification) => {
      navigate('/knowledge');
      dismiss(notification.id);
    },
    [navigate, dismiss],
  );

  // Only show undismissed notifications from the last 6 seconds
  const freshNotifications = notifications.filter(
    (n) => !n.dismissed && Date.now() - n.timestamp < 6000,
  );

  if (freshNotifications.length === 0) return null;

  return (
    <div className="fixed bottom-16 right-4 z-50 flex flex-col gap-2">
      {freshNotifications.slice(0, 3).map((notification) => {
        const style = getSeverityStyle(notification.severity);
        const { Icon } = style;

        return (
          <div
            key={notification.id}
            className={`flex w-80 cursor-pointer items-start gap-2.5 rounded-lg border bg-white px-3 py-2.5 shadow-lg transition-all hover:shadow-xl dark:bg-gray-800 ${style.border}`}
            onClick={() => handleClick(notification)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleClick(notification);
            }}
          >
            <Icon size={16} className={`mt-0.5 flex-shrink-0 ${style.iconColor}`} />
            <div className="min-w-0 flex-1">
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${style.labelColor}`}>
                {style.label}
              </p>
              <p className="mt-0.5 text-xs text-gray-700 dark:text-gray-300">
                {notification.message}
              </p>
              {notification.detail && (
                <p className="mt-0.5 line-clamp-2 text-[10px] text-gray-500 dark:text-gray-400">
                  {notification.detail}
                </p>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismiss(notification.id);
              }}
              className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
