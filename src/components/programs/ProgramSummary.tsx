/**
 * Programs Summary table — flat sortable view of all programs with execution history.
 * Mirrors the UDAC Programs Summary page: Name, Enabled, Status, Activity, Path,
 * Last Run Time, Last Finish Time, Next Scheduled Run, ID.
 */
import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react';
import { useProgramStore } from '@/stores/program-store.ts';
import { boolAttr } from '@/utils/xml-parser.ts';
import type { IsyProgram } from '@/api/types.ts';

type SortField =
  | 'name'
  | 'enabled'
  | 'status'
  | 'running'
  | 'path'
  | 'lastRunTime'
  | 'lastFinishTime'
  | 'nextScheduledRunTime'
  | 'id';
type SortDir = 'asc' | 'desc';

interface Props {
  onSelectProgram: (id: string) => void;
}

/** Build a path string from the folder hierarchy */
function buildPath(program: IsyProgram, allPrograms: IsyProgram[]): string {
  const parts: string[] = [];
  let parentId = program['@_parentId'];
  const visited = new Set<string>();

  while (parentId && parentId !== '0001' && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = allPrograms.find((p) => p['@_id'] === parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    parentId = parent['@_parentId'];
  }

  return parts.join(' / ') || '—';
}

/** Format an ISY timestamp for display */
function formatTime(time?: string): string {
  if (!time || !time.trim()) return '';
  return time.trim();
}

/** Map @_status to a readable label */
function statusLabel(status: string): string {
  // ISY status: 'true' = IF condition currently true, 'false' = IF condition false
  if (status === 'true' || status === true as unknown) return 'True';
  if (status === 'false' || status === false as unknown) return 'False';
  // Other values: Not Loaded, Out of Memory, etc.
  return String(status);
}

/** Map @_running to an activity label */
function activityLabel(running?: string): string {
  if (!running) return 'Idle';
  if (running === 'idle' || running === 'false') return 'Idle';
  if (running === 'then') return 'Running Then';
  if (running === 'else') return 'Running Else';
  return String(running);
}

export function ProgramSummary({ onSelectProgram }: Props) {
  const programs = useProgramStore((s) => s.programs);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filter, setFilter] = useState('');

  // Only show actual programs, not folders
  const programList = useMemo(
    () => programs.filter((p) => !boolAttr(p['@_folder'])),
    [programs],
  );

  // Build path cache
  const pathCache = useMemo(() => {
    const cache = new Map<string, string>();
    for (const p of programList) {
      cache.set(p['@_id'], buildPath(p, programs));
    }
    return cache;
  }, [programList, programs]);

  // Filter
  const filtered = useMemo(() => {
    if (!filter) return programList;
    const lf = filter.toLowerCase();
    return programList.filter(
      (p) =>
        p.name.toLowerCase().includes(lf) ||
        (pathCache.get(p['@_id']) ?? '').toLowerCase().includes(lf) ||
        p['@_id'].toLowerCase().includes(lf),
    );
  }, [programList, filter, pathCache]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'enabled':
          cmp = String(a['@_enabled']).localeCompare(String(b['@_enabled']));
          break;
        case 'status':
          cmp = statusLabel(a['@_status']).localeCompare(statusLabel(b['@_status']));
          break;
        case 'running':
          cmp = activityLabel(a['@_running']).localeCompare(activityLabel(b['@_running']));
          break;
        case 'path':
          cmp = (pathCache.get(a['@_id']) ?? '').localeCompare(pathCache.get(b['@_id']) ?? '');
          break;
        case 'lastRunTime':
          cmp = (a.lastRunTime ?? '').localeCompare(b.lastRunTime ?? '');
          break;
        case 'lastFinishTime':
          cmp = (a.lastFinishTime ?? '').localeCompare(b.lastFinishTime ?? '');
          break;
        case 'nextScheduledRunTime':
          cmp = (a.nextScheduledRunTime ?? '').localeCompare(b.nextScheduledRunTime ?? '');
          break;
        case 'id':
          cmp = a['@_id'].localeCompare(b['@_id']);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortField, sortDir, pathCache]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field)
      return <span className="ml-0.5 inline-block w-3" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={12} className="ml-0.5 inline" />
    ) : (
      <ChevronDown size={12} className="ml-0.5 inline" />
    );
  }

  const thClass =
    'cursor-pointer select-none px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300 dark:text-gray-400 dark:hover:text-gray-200';

  return (
    <div className="flex h-full flex-col">
      {/* Header with filter */}
      <div className="flex items-center gap-3 px-1 pb-3">
        <input
          type="text"
          placeholder="Filter programs..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-64 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {sorted.length} of {programList.length} programs
        </span>
      </div>

      {/* Scrollable table */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-100 dark:bg-gray-800">
            <tr>
              <th className={thClass} onClick={() => toggleSort('name')}>
                Name <SortIcon field="name" />
              </th>
              <th className={thClass} onClick={() => toggleSort('enabled')}>
                Enabled <SortIcon field="enabled" />
              </th>
              <th className={thClass} onClick={() => toggleSort('running')}>
                Activity <SortIcon field="running" />
              </th>
              <th className={thClass} onClick={() => toggleSort('status')}>
                Status <SortIcon field="status" />
              </th>
              <th className={thClass} onClick={() => toggleSort('path')}>
                Folder <SortIcon field="path" />
              </th>
              <th className={thClass} onClick={() => toggleSort('lastRunTime')}>
                Last Run <SortIcon field="lastRunTime" />
              </th>
              <th className={thClass} onClick={() => toggleSort('lastFinishTime')}>
                Last Finished <SortIcon field="lastFinishTime" />
              </th>
              <th className={thClass} onClick={() => toggleSort('nextScheduledRunTime')}>
                Next Scheduled <SortIcon field="nextScheduledRunTime" />
              </th>
              <th className={thClass} onClick={() => toggleSort('id')}>
                ID <SortIcon field="id" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {sorted.map((p) => {
              const enabled = boolAttr(p['@_enabled']);
              const status = statusLabel(p['@_status']);
              const activity = activityLabel(p['@_running']);
              const isRunning = activity !== 'Idle';
              const isError =
                status === 'Not Loaded' ||
                status === 'Out of Memory' ||
                activity === 'Not Loaded';

              return (
                <tr
                  key={p['@_id']}
                  onClick={() => onSelectProgram(p['@_id'])}
                  className={`cursor-pointer transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/30 ${
                    isError
                      ? 'bg-red-950/20'
                      : !enabled
                        ? 'opacity-50'
                        : ''
                  }`}
                >
                  <td className="max-w-[200px] truncate px-3 py-1.5 font-medium text-gray-900 dark:text-gray-100">
                    {p.name}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`text-xs font-medium ${
                        enabled
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {enabled ? 'On' : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`text-xs ${
                        isRunning
                          ? 'font-medium text-blue-600 dark:text-blue-400'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {activity}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    {isError ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
                        <AlertTriangle size={12} /> {status}
                      </span>
                    ) : (
                      <span
                        className={`text-xs ${
                          status === 'True'
                            ? 'font-medium text-green-600 dark:text-green-400'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {status}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {pathCache.get(p['@_id']) ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {formatTime(p.lastRunTime) || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {formatTime(p.lastFinishTime) || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {formatTime(p.nextScheduledRunTime) || '—'}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-gray-400 dark:text-gray-500">
                    {p['@_id']}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
