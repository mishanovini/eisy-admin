/**
 * IssueReportPanel — compose or view a bug report / feature request.
 * Slide-out modal for creating detailed reports with auto-captured diagnostics.
 *
 * Compose mode: Pre-fills from Troubleshooter/AI context, user reviews & submits.
 * View mode: Shows submitted report details, status, and developer response.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Bug,
  Lightbulb,
  Send,
  Loader2,
  Info,
  Cpu,
  FileText,
  AlertCircle,
  CheckCircle2,
  Github,
} from 'lucide-react';
import { useIssueStore, type IssueReport, type IssueType } from '@/stores/issue-store.ts';
import { useLogStore, type LogEntry } from '@/stores/log-store.ts';
import { hasGitHubToken } from '@/api/github.ts';
import { APP_VERSION } from '@/utils/version.ts';

interface IssueReportPanelProps {
  /** Existing report ID to view (view mode) */
  reportId?: number;
  /** Pre-fill data from Troubleshooter or AI */
  prefill?: {
    type?: IssueType;
    title?: string;
    description?: string;
    aiDiagnosis?: string;
    proposedFix?: string;
    category?: string;
    devices?: string[];
    deviceNames?: string[];
  };
  /** Close the panel */
  onClose: () => void;
  /** Called after successful submission */
  onSubmitted?: (report: IssueReport) => void;
}

export function IssueReportPanel({ reportId, prefill, onClose, onSubmitted }: IssueReportPanelProps) {
  const createReport = useIssueStore((s) => s.createReport);
  const updateReport = useIssueStore((s) => s.updateReport);
  const submitReport = useIssueStore((s) => s.submitReport);
  const captureSystemInfo = useIssueStore((s) => s.captureSystemInfo);
  const existingReport = useIssueStore((s) => reportId ? s.getReport(reportId) : undefined);

  const [type, setType] = useState<IssueType>(prefill?.type ?? existingReport?.type ?? 'bug');
  const [title, setTitle] = useState(prefill?.title ?? existingReport?.title ?? '');
  const [description, setDescription] = useState(prefill?.description ?? existingReport?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-capture relevant logs (last 20 entries)
  const recentLogs = useLogStore((s) => s.entries.slice(0, 20));

  // If viewing an existing report, show view mode
  const isViewMode = !!existingReport && existingReport.status !== 'draft';

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) {
      setError('Please provide a title for the report');
      return;
    }
    if (!description.trim()) {
      setError('Please describe the issue');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const systemInfo = captureSystemInfo();
      const reportData = {
        type,
        title: title.trim(),
        description: description.trim(),
        aiDiagnosis: prefill?.aiDiagnosis ?? existingReport?.aiDiagnosis,
        proposedFix: prefill?.proposedFix ?? existingReport?.proposedFix,
        category: prefill?.category ?? existingReport?.category,
        devices: prefill?.devices ?? existingReport?.devices,
        deviceNames: prefill?.deviceNames ?? existingReport?.deviceNames,
        logs: recentLogs as LogEntry[],
        systemInfo,
      };

      let report: IssueReport;
      if (existingReport?.id) {
        await updateReport(existingReport.id, reportData);
        report = { ...existingReport, ...reportData };
      } else {
        report = await createReport(reportData);
      }

      onSubmitted?.(report);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save report');
    } finally {
      setSaving(false);
    }
  }, [type, title, description, prefill, existingReport, recentLogs, captureSystemInfo, createReport, updateReport, onSubmitted, onClose]);

  /** Submit to GitHub — saves the report first if needed, then creates a GitHub issue */
  const handleGitHubSubmit = useCallback(async () => {
    if (!title.trim()) {
      setError('Please provide a title for the report');
      return;
    }
    if (!description.trim()) {
      setError('Please describe the issue');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const systemInfo = captureSystemInfo();
      const reportData = {
        type,
        title: title.trim(),
        description: description.trim(),
        aiDiagnosis: prefill?.aiDiagnosis ?? existingReport?.aiDiagnosis,
        proposedFix: prefill?.proposedFix ?? existingReport?.proposedFix,
        category: prefill?.category ?? existingReport?.category,
        devices: prefill?.devices ?? existingReport?.devices,
        deviceNames: prefill?.deviceNames ?? existingReport?.deviceNames,
        logs: recentLogs as LogEntry[],
        systemInfo,
      };

      // Save locally first if not already saved
      let reportId = existingReport?.id;
      if (!reportId) {
        const created = await createReport(reportData);
        reportId = created.id;
      } else {
        await updateReport(reportId, reportData);
      }

      // Submit to GitHub
      if (reportId) {
        await submitReport(reportId);
        setSubmitted(true);
        // Brief delay so user sees success state before close
        setTimeout(() => {
          onSubmitted?.({ ...reportData, id: reportId, timestamp: Date.now(), status: 'submitted' } as IssueReport);
          onClose();
        }, 1200);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit to GitHub');
    } finally {
      setSubmitting(false);
    }
  }, [type, title, description, prefill, existingReport, recentLogs, captureSystemInfo, createReport, updateReport, submitReport, onSubmitted, onClose]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {isViewMode ? 'Issue Report' : reportId ? 'Edit Report' : 'New Issue Report'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* View mode — existing report details */}
          {isViewMode && existingReport && (
            <>
              <ViewModeContent report={existingReport} />
            </>
          )}

          {/* Edit/Create mode */}
          {!isViewMode && (
            <>
              {/* Type selector */}
              <div className="flex gap-3">
                <button
                  onClick={() => setType('bug')}
                  className={`flex flex-1 items-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-colors ${
                    type === 'bug'
                      ? 'border-red-400 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-900/20 dark:text-red-300'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600'
                  }`}
                >
                  <Bug size={18} />
                  Bug Report
                </button>
                <button
                  onClick={() => setType('feature')}
                  className={`flex flex-1 items-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-colors ${
                    type === 'feature'
                      ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-900/20 dark:text-amber-300'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600'
                  }`}
                >
                  <Lightbulb size={18} />
                  Feature Request
                </button>
              </div>

              {/* Title */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={type === 'bug' ? 'Brief description of the bug...' : 'Feature you\'d like to see...'}
                  className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={type === 'bug'
                    ? 'What happened? What did you expect to happen?'
                    : 'Describe the feature and how it would help...'}
                  rows={4}
                  className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
                />
              </div>

              {/* AI Diagnosis (read-only, auto-captured) */}
              {(prefill?.aiDiagnosis || existingReport?.aiDiagnosis) && (
                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <Cpu size={12} /> AI Diagnosis
                  </label>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
                    <pre className="whitespace-pre-wrap font-sans">
                      {prefill?.aiDiagnosis ?? existingReport?.aiDiagnosis}
                    </pre>
                  </div>
                </div>
              )}

              {/* Proposed Fix (read-only) */}
              {(prefill?.proposedFix || existingReport?.proposedFix) && (
                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <FileText size={12} /> Proposed Fix
                  </label>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300">
                    <pre className="whitespace-pre-wrap font-sans">
                      {prefill?.proposedFix ?? existingReport?.proposedFix}
                    </pre>
                  </div>
                </div>
              )}

              {/* Affected devices */}
              {(prefill?.deviceNames || existingReport?.deviceNames) && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Devices:
                  </span>
                  {(prefill?.deviceNames ?? existingReport?.deviceNames ?? []).map((name) => (
                    <span key={name} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {name}
                    </span>
                  ))}
                </div>
              )}

              {/* Auto-captured data summary */}
              <div className="flex items-center gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <Info size={14} />
                <span>
                  Auto-captured: {recentLogs.length} log entries, system info (v{APP_VERSION}, {new Date().toLocaleDateString()})
                </span>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!isViewMode && (
          <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 dark:border-gray-700">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <div className="flex items-center gap-2">
              {/* Save as local draft */}
              <button
                onClick={handleSubmit}
                disabled={saving || submitting}
                className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                Save Draft
              </button>
              {/* Submit directly to GitHub */}
              {hasGitHubToken() && (
                <button
                  onClick={handleGitHubSubmit}
                  disabled={submitting || saving || submitted}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 ${
                    submitted
                      ? 'bg-green-600 dark:bg-green-500'
                      : 'bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
                  }`}
                >
                  {submitting
                    ? <Loader2 size={14} className="animate-spin" />
                    : submitted
                      ? <CheckCircle2 size={14} />
                      : <Github size={14} />}
                  {submitting ? 'Submitting...' : submitted ? 'Submitted!' : 'Submit to GitHub'}
                </button>
              )}
              {/* Fallback: regular save if no token */}
              {!hasGitHubToken() && (
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {existingReport ? 'Update Report' : 'Save Report'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Read-only view of a submitted report */
function ViewModeContent({ report }: { report: IssueReport }) {
  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    acknowledged: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    'in-progress': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    resolved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    closed: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
  };

  return (
    <div className="space-y-4">
      {/* Status + Type badges */}
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${statusColors[report.status] ?? statusColors.draft}`}>
          {report.status}
        </span>
        <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
          report.type === 'bug'
            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        }`}>
          {report.type === 'bug' ? 'Bug' : 'Feature'}
        </span>
        {report.githubIssueUrl && (
          <a
            href={report.githubIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            #{report.githubIssueNumber}
          </a>
        )}
      </div>

      {/* Title */}
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{report.title}</h3>

      {/* Description */}
      <p className="text-sm text-gray-700 dark:text-gray-300">{report.description}</p>

      {/* AI Diagnosis */}
      {report.aiDiagnosis && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
          <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            <Cpu size={12} /> AI Diagnosis
          </h4>
          <pre className="whitespace-pre-wrap font-sans text-xs text-blue-800 dark:text-blue-300">
            {report.aiDiagnosis}
          </pre>
        </div>
      )}

      {/* Resolution */}
      {report.resolution && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/30">
          <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">
            <CheckCircle2 size={12} /> Resolution
          </h4>
          <p className="text-xs text-green-800 dark:text-green-300">{report.resolution}</p>
          {report.resolvedVersion && (
            <p className="mt-1 text-xs font-medium text-green-600 dark:text-green-400">
              Fixed in v{report.resolvedVersion}
            </p>
          )}
        </div>
      )}

      {/* System info */}
      {report.systemInfo && (
        <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            System Info
          </h4>
          <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>v{report.systemInfo.appVersion}</span>
            <span>{report.systemInfo.deviceCount} devices</span>
            <span>{report.systemInfo.programCount} programs</span>
            <span>WS: {report.systemInfo.wsConnected ? 'connected' : 'disconnected'}</span>
          </div>
        </div>
      )}

      {/* Timestamp */}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Created {new Date(report.timestamp).toLocaleString()}
      </p>
    </div>
  );
}
