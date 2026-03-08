/**
 * IssueHistory — list of all submitted bug reports and feature requests.
 * Shows status badges, timestamps, and allows viewing/editing reports.
 */
import { useState, useEffect } from 'react';
import {
  Bug,
  Lightbulb,
  ChevronRight,
  ExternalLink,
  Trash2,
  RefreshCw,
  Inbox,
} from 'lucide-react';
import { useIssueStore, type IssueReport, type IssueStatus } from '@/stores/issue-store.ts';
import { IssueReportPanel } from './IssueReportPanel.tsx';

type StatusFilter = 'all' | 'open' | 'resolved' | 'draft';

const STATUS_LABELS: Record<IssueStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  acknowledged: 'Acknowledged',
  'in-progress': 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const STATUS_COLORS: Record<IssueStatus, string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  acknowledged: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  'in-progress': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  resolved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  closed: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
};

export function IssueHistory() {
  const reports = useIssueStore((s) => s.reports);
  const loading = useIssueStore((s) => s.loading);
  const loadReports = useIssueStore((s) => s.loadReports);
  const deleteReport = useIssueStore((s) => s.deleteReport);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);

  // Load reports on mount
  useEffect(() => {
    loadReports();
  }, [loadReports]);

  // Filter reports
  const filteredReports = reports.filter((r) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'open') return ['submitted', 'acknowledged', 'in-progress'].includes(r.status);
    if (statusFilter === 'resolved') return ['resolved', 'closed'].includes(r.status);
    if (statusFilter === 'draft') return r.status === 'draft';
    return true;
  });

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this report? This cannot be undone.')) {
      await deleteReport(id);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Issue Reports ({reports.length})
        </h3>
        <div className="flex items-center gap-2">
          {/* Status filter */}
          <div className="flex items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
            {(['all', 'draft', 'open', 'resolved'] as StatusFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  statusFilter === filter
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>
          <button
            onClick={() => loadReports()}
            disabled={loading}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Reports list */}
      {filteredReports.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-gray-400 dark:text-gray-500">
          <Inbox size={32} />
          <p className="text-sm">
            {reports.length === 0
              ? 'No issue reports yet'
              : `No ${statusFilter} reports`}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filteredReports.map((report) => (
            <IssueRow
              key={report.id}
              report={report}
              onClick={() => setSelectedReportId(report.id!)}
              onDelete={(e) => handleDelete(report.id!, e)}
            />
          ))}
        </div>
      )}

      {/* Report detail panel */}
      {selectedReportId && (
        <IssueReportPanel
          reportId={selectedReportId}
          onClose={() => setSelectedReportId(null)}
        />
      )}
    </div>
  );
}

function IssueRow({
  report,
  onClick,
  onDelete,
}: {
  report: IssueReport;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const timeStr = new Date(report.timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: report.timestamp < Date.now() - 180 * 86400_000 ? 'numeric' : undefined,
  });

  return (
    <div
      onClick={onClick}
      className="group flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800/50"
    >
      {/* Type icon */}
      <div className={`rounded-lg p-1.5 ${
        report.type === 'bug'
          ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
          : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
      }`}>
        {report.type === 'bug' ? <Bug size={14} /> : <Lightbulb size={14} />}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {report.title}
          </h4>
          {/* Status badge */}
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[report.status]}`}>
            {STATUS_LABELS[report.status]}
          </span>
          {/* Update available indicator */}
          {report.resolvedVersion && (
            <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Fix in v{report.resolvedVersion}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
          {timeStr}
          {report.githubIssueNumber && ` · #${report.githubIssueNumber}`}
          {report.deviceNames?.length ? ` · ${report.deviceNames.join(', ')}` : ''}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {report.githubIssueUrl && (
          <a
            href={report.githubIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-700 dark:hover:text-blue-400"
            title="View on GitHub"
          >
            <ExternalLink size={14} />
          </a>
        )}
        {report.status === 'draft' && (
          <button
            onClick={onDelete}
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            title="Delete draft"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <ChevronRight size={14} className="shrink-0 text-gray-300 dark:text-gray-600" />
    </div>
  );
}
