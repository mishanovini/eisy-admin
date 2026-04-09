/**
 * Logs page — tabbed viewer for event logs with dedicated eisy live feed.
 *
 * Architecture:
 * - "All" tab shows aggregated logs from IndexedDB (command, comms, program,
 *   portal, scene) — but NOT eisy status events (those are redundant with comms)
 * - Category tabs (Commands, Comms, etc.) filter IndexedDB entries
 * - "eisy" tab shows a dedicated live event viewer reading from the eisy's
 *   native event buffer — not IndexedDB. Only polls while this tab is active.
 *
 * The table uses sticky headers so columns stay visible while scrolling.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Download,
  RefreshCw,
  Trash2,
  Terminal,
  Wifi,
  Code2,
  Cloud,
  Server,
  AlertTriangle,
  Filter,
  Link2,
  Radio,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { useLogStore, type LogCategory, type LogEntry } from '@/stores/log-store.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import { useEisyLogStore, type EisyLogLevel, type EisyLiveEntry } from '@/stores/eisy-log-store.ts';
import { getSceneMembers } from '@/utils/scene-utils.ts';

type TabId = 'command' | 'comms' | 'program' | 'portal' | 'eisy' | 'all';

const TABS: { id: TabId; label: string; icon: React.ReactNode; category?: LogCategory }[] = [
  { id: 'all', label: 'All', icon: <Filter size={14} /> },
  { id: 'eisy', label: 'eisy', icon: <Server size={14} /> },
  { id: 'command', label: 'Commands', icon: <Terminal size={14} />, category: 'command' },
  { id: 'comms', label: 'Communications', icon: <Wifi size={14} />, category: 'comms' },
  { id: 'program', label: 'Programs', icon: <Code2 size={14} />, category: 'program' },
  { id: 'portal', label: 'Portal', icon: <Cloud size={14} />, category: 'portal' },
];

/**
 * Check if a D2D text block contains a device address.
 * Handles format variations: dots vs spaces (Insteon "28.A5.D8" vs "28 A5 D8").
 */
function containsAddress(d2dBlock: string, address: string): boolean {
  const block = d2dBlock.toLowerCase();
  const addr = address.toLowerCase();
  if (block.includes(addr)) return true;
  const addrSpaces = addr.replace(/\./g, ' ');
  if (addrSpaces !== addr && block.includes(addrSpaces)) return true;
  const addrDots = addr.replace(/ /g, '.');
  if (addrDots !== addr && block.includes(addrDots)) return true;
  return false;
}

export function LogsPage() {
  const entries = useLogStore((s) => s.entries);
  const loading = useLogStore((s) => s.loading);
  const loadEntries = useLogStore((s) => s.loadEntries);
  const exportCsv = useLogStore((s) => s.exportCsv);
  const purgeOld = useLogStore((s) => s.purgeOld);
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'success' | 'fail'>('all');
  const [showRelated, setShowRelated] = useState(true);

  // eisy live feed state
  const eisyPolling = useEisyLogStore((s) => s.polling);
  const eisyLevel = useEisyLogStore((s) => s.level);
  const eisyPersisted = useEisyLogStore((s) => s.persistedCount);
  const eisyLiveEntries = useEisyLogStore((s) => s.liveEntries);
  const eisySetLevel = useEisyLogStore((s) => s.setLevel);
  const eisyStartPolling = useEisyLogStore((s) => s.startPolling);
  const eisyStopPolling = useEisyLogStore((s) => s.stopPolling);
  const [eisyShowStatus, setEisyShowStatus] = useState(true);

  // Button action states — provide visual feedback during async operations
  const [exporting, setExporting] = useState(false);
  const [purging, setPurging] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>();

  /** Show a brief feedback message next to the action buttons */
  const showFeedback = useCallback((message: string) => {
    clearTimeout(feedbackTimer.current);
    setActionFeedback(message);
    feedbackTimer.current = setTimeout(() => setActionFeedback(null), 3000);
  }, []);

  // Only poll when the eisy tab is active
  useEffect(() => {
    if (activeTab === 'eisy') {
      eisyStartPolling();
      return () => eisyStopPolling();
    }
  }, [activeTab, eisyStartPolling, eisyStopPolling]);

  // Device and program data for correlation filtering
  const nodeMap = useDeviceStore((s) => s.nodeMap);
  const scenes = useDeviceStore((s) => s.scenes);
  const triggers = useProgramStore((s) => s.triggers);
  const programs = useProgramStore((s) => s.programs);

  // Build a Set of all related addresses when filtering by device
  const relatedAddresses = useMemo(() => {
    if (!deviceFilter.trim() || !showRelated) return null;
    const filter = deviceFilter.toLowerCase().trim();
    const set = new Set<string>();

    for (const [addr, node] of nodeMap) {
      if (node.name.toLowerCase().includes(filter) || addr.toLowerCase().includes(filter)) {
        set.add(addr);
      }
    }
    for (const scene of scenes) {
      const sceneAddr = String(scene.address);
      if (scene.name?.toLowerCase().includes(filter) || sceneAddr.toLowerCase().includes(filter)) {
        set.add(sceneAddr);
      }
    }

    if (set.size === 0) return null;

    // Expand with scenes containing matched devices
    for (const scene of scenes) {
      const sceneAddr = String(scene.address);
      if (set.has(sceneAddr)) continue;
      const members = getSceneMembers(scene, nodeMap);
      if (members.some((m) => set.has(m.address))) {
        set.add(sceneAddr);
      }
    }

    // Expand with programs referencing matched addresses
    for (const trigger of triggers) {
      const progId = String(trigger.id);
      if (set.has(progId)) continue;
      const d2dText = [trigger.if ?? '', trigger.then ?? '', trigger.else ?? ''].join(' ');
      if (!d2dText.trim()) continue;
      for (const addr of set) {
        if (containsAddress(d2dText, addr)) {
          set.add(progId);
          break;
        }
      }
    }
    for (const prog of programs) {
      const progId = String(prog['@_id']);
      if (set.has(progId)) continue;
      if (prog.name?.toLowerCase().includes(filter)) {
        set.add(progId);
      }
    }

    return set;
  }, [deviceFilter, showRelated, nodeMap, scenes, triggers, programs]);

  // Load IndexedDB entries on mount, tab change (only for non-eisy tabs).
  // Uses sequential setTimeout instead of setInterval — the next poll only
  // starts after the previous one completes. This prevents overlapping reads
  // from piling up and exhausting memory when IndexedDB is slow.
  useEffect(() => {
    if (activeTab === 'eisy') return; // eisy tab uses live feed, not IndexedDB
    const category = TABS.find((t) => t.id === activeTab)?.category;
    let cancelled = false;

    async function refresh() {
      if (cancelled) return;
      await loadEntries({
        category,
        excludeCategory: activeTab === 'all' ? 'eisy' : undefined,
        limit: 500,
      });
      if (!cancelled) {
        setTimeout(refresh, 5000);
      }
    }

    void refresh();
    return () => { cancelled = true; };
  }, [activeTab, loadEntries]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const csv = await exportCsv();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eisy-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showFeedback('CSV exported');
    } catch {
      showFeedback('Export failed');
    } finally {
      setExporting(false);
    }
  }, [exportCsv, showFeedback]);

  const handlePurge = useCallback(async () => {
    setPurging(true);
    try {
      const deleted = await purgeOld();
      if (deleted > 0) {
        const category = TABS.find((t) => t.id === activeTab)?.category;
        await loadEntries({
          category,
          excludeCategory: activeTab === 'all' ? 'eisy' : undefined,
          limit: 500,
        });
        showFeedback(`Purged ${deleted} old entries`);
      } else {
        showFeedback('No old entries to purge');
      }
    } catch {
      showFeedback('Purge failed');
    } finally {
      setPurging(false);
    }
  }, [purgeOld, loadEntries, activeTab, showFeedback]);

  // Filter IndexedDB entries (for non-eisy tabs)
  const filteredEntries = useMemo(() => {
    let items = entries;

    // Defensive category filter: when switching tabs, the in-memory `entries`
    // may still hold data from the previous tab's async DB query. Filter to
    // the expected category so stale rows don't flash during the transition.
    // (The "All" tab's eisy exclusion is now handled at the store level via
    // excludeCategory, but we still guard against stale data here.)
    if (activeTab === 'all') {
      items = items.filter((e) => e.category !== 'eisy');
    } else if (activeTab !== 'eisy') {
      const expectedCategory = TABS.find((t) => t.id === activeTab)?.category;
      if (expectedCategory) {
        items = items.filter((e) => e.category === expectedCategory);
      }
    }

    return items.filter((e) => {
      if (deviceFilter.trim()) {
        if (relatedAddresses) {
          const entryAddr = e.device ? String(e.device) : '';
          const matchesSet = entryAddr && relatedAddresses.has(entryAddr);
          const matchesText = e.deviceName?.toLowerCase().includes(deviceFilter.toLowerCase())
            || e.device?.toLowerCase().includes(deviceFilter.toLowerCase());
          if (!matchesSet && !matchesText) return false;
        } else {
          if (!e.deviceName?.toLowerCase().includes(deviceFilter.toLowerCase())
            && !e.device?.toLowerCase().includes(deviceFilter.toLowerCase())) {
            return false;
          }
        }
      }
      if (resultFilter !== 'all' && e.result !== resultFilter) return false;
      return true;
    });
  }, [entries, activeTab, deviceFilter, resultFilter, relatedAddresses]);

  // Filter eisy live entries
  const filteredLiveEntries = useMemo(() => {
    let items = eisyLiveEntries;
    if (!eisyShowStatus) {
      items = items.filter((e) => !e.isStatus);
    }
    if (deviceFilter.trim()) {
      const filter = deviceFilter.toLowerCase();
      items = items.filter((e) =>
        e.deviceName?.toLowerCase().includes(filter) ||
        e.device?.toLowerCase().includes(filter),
      );
    }
    return items;
  }, [eisyLiveEntries, eisyShowStatus, deviceFilter]);

  const isEisyTab = activeTab === 'eisy';
  const displayCount = isEisyTab ? filteredLiveEntries.length : filteredEntries.length;

  return (
    <div className="flex h-full flex-col space-y-3">
      {/* Header with tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Action feedback toast */}
          {actionFeedback && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 animate-in fade-in">
              <CheckCircle2 size={12} />
              {actionFeedback}
            </span>
          )}

          {!isEisyTab && (
            <button
              onClick={() => {
                const category = TABS.find((t) => t.id === activeTab)?.category;
                loadEntries({
                  category,
                  excludeCategory: activeTab === 'all' ? 'eisy' : undefined,
                  limit: 500,
                });
              }}
              disabled={loading}
              className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button
            onClick={handlePurge}
            disabled={purging}
            className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-gray-600 dark:text-red-400 dark:hover:bg-red-900/20"
            title="Purge entries older than 30 days"
          >
            {purging ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {purging ? 'Purging…' : 'Purge Old'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={deviceFilter}
          onChange={(e) => setDeviceFilter(e.target.value)}
          placeholder="Filter by device..."
          className="rounded border border-gray-300 bg-transparent px-2 py-1 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
        />
        {!isEisyTab && (
          <button
            onClick={() => setShowRelated(!showRelated)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition-colors ${
              showRelated
                ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : 'border-gray-300 text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
            title={showRelated
              ? 'Showing related scenes & programs — click to show exact matches only'
              : 'Showing exact matches only — click to include related scenes & programs'}
          >
            <Link2 size={12} />
            Related
          </button>
        )}
        {!isEisyTab && (
          <select
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value as 'all' | 'success' | 'fail')}
            className="rounded border border-gray-300 bg-transparent px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:bg-gray-800"
          >
            <option value="all">All Results</option>
            <option value="success">Success</option>
            <option value="fail">Failed</option>
          </select>
        )}

        {/* eisy tab controls */}
        {isEisyTab && (
          <div className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800">
            <Server size={12} className={eisyPolling ? 'text-green-500' : 'text-gray-400'} />
            <select
              value={eisyLevel}
              onChange={(e) => eisySetLevel(Number(e.target.value) as EisyLogLevel)}
              className="rounded border border-gray-300 bg-transparent px-1.5 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              title="eisy event log verbosity level"
            >
              <option value={0}>Level 0 — None</option>
              <option value={1}>Level 1 — Status/Operational</option>
              <option value={2}>Level 2 — More Info</option>
              <option value={3}>Level 3 — Device Comms</option>
            </select>
            {eisyPolling && (
              <span className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                Live
              </span>
            )}
            <button
              onClick={() => setEisyShowStatus(!eisyShowStatus)}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                eisyShowStatus
                  ? 'border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400'
                  : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
              }`}
              title={eisyShowStatus ? 'Showing all events — click to hide status updates' : 'Hiding status updates — click to show all'}
            >
              <Radio size={10} />
              {eisyShowStatus ? 'All Events' : 'Ops Only'}
            </button>
            {eisyPersisted > 0 && (
              <span className="text-[10px] text-gray-400">
                {eisyPersisted} ops saved
              </span>
            )}
          </div>
        )}

        <span className="text-xs text-gray-400 dark:text-gray-500">
          {displayCount} entries
          {!isEisyTab && relatedAddresses && deviceFilter.trim() && (
            <span className="ml-1">({relatedAddresses.size} related)</span>
          )}
        </span>
      </div>

      {/* Log table — scrollable with sticky headers */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="h-full overflow-auto">
          {isEisyTab ? (
            <EisyLiveTable entries={filteredLiveEntries} />
          ) : (
            <LogTable entries={filteredEntries} loading={loading} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Standard log table (IndexedDB entries) ─────────────────

function LogTable({ entries, loading }: { entries: LogEntry[]; loading: boolean }) {
  return (
    <div className="relative">
      {/* Loading overlay — visible even when rows exist, so user knows data is refreshing */}
      {loading && entries.length > 0 && (
        <div className="absolute inset-0 z-20 flex items-start justify-center bg-white/60 pt-16 dark:bg-gray-900/60">
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 shadow-md dark:border-gray-700 dark:bg-gray-800">
            <Loader2 size={16} className="animate-spin text-blue-500" />
            <span className="text-sm text-gray-600 dark:text-gray-300">Loading logs…</span>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/95">
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Time</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Category</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Device</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Action</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Source</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Result</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    Loading logs…
                  </span>
                ) : (
                  'No log entries yet. Device commands and events will appear here.'
                )}
              </td>
            </tr>
          )}
          {entries.map((entry, idx) => (
            <LogRow key={entry.id ?? idx} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Translate raw ISY command actions into human-readable text */
function humanizeLogAction(action: string): string {
  const donMatch = action.match(/^DON(?:\s+(\d+))?$/);
  if (donMatch) {
    const val = donMatch[1] ? parseInt(donMatch[1], 10) : undefined;
    if (val === undefined || val === 255) return 'Turn On';
    return `Dim to ${Math.round((val / 255) * 100)}%`;
  }
  if (action === 'DOF') return 'Turn Off';
  if (action === 'DFON') return 'Fast On';
  if (action === 'DFOF') return 'Fast Off';
  if (action === 'LOCK') return 'Lock';
  if (action === 'UNLOCK') return 'Unlock';
  if (action === 'BRT') return 'Brighten';
  if (action === 'DIM') return 'Dim';
  if (action === 'QUERY') return 'Query Status';
  const setMatch = action.match(/^Set (\w+) = (\d+)$/);
  if (setMatch && setMatch[1] && setMatch[2]) {
    const prop = setMatch[1];
    const val = parseInt(setMatch[2], 10);
    if (prop === 'OL') return `Set On-Level to ${Math.round((val / 255) * 100)}%`;
    if (prop === 'RR') return `Set Ramp Rate to ${val}`;
    return `Set ${prop} to ${val}`;
  }
  return action;
}

const categoryColors: Record<LogCategory, string> = {
  eisy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  command: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  scene: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  comms: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  program: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  portal: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
};

function LogRow({ entry }: { entry: LogEntry }) {
  const time = new Date(entry.timestamp);
  const timeStr = `${time.toLocaleDateString()} ${time.toLocaleTimeString()}`;
  const displayAction = humanizeLogAction(entry.action);

  // Show device name with address as tooltip, or just address if no name
  const deviceDisplay = entry.deviceName
    ? entry.deviceName
    : entry.device ?? '—';
  const deviceTitle = entry.deviceName && entry.device
    ? `${entry.deviceName} (${entry.device})`
    : undefined;

  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/30">
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-500 dark:text-gray-400">
        {timeStr}
      </td>
      <td className="px-3 py-1.5">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${categoryColors[entry.category]}`}>
          {entry.category}
        </span>
      </td>
      <td className="px-3 py-1.5 text-gray-900 dark:text-gray-100" title={deviceTitle}>
        {deviceDisplay}
        {entry.deviceName && entry.device && (
          <span className="ml-1.5 text-[10px] text-gray-400 dark:text-gray-500">{entry.device}</span>
        )}
      </td>
      <td className="max-w-xs truncate px-3 py-1.5 text-gray-700 dark:text-gray-300" title={entry.action !== displayAction ? entry.action : undefined}>
        {displayAction}
      </td>
      <td className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">
        {entry.source}
      </td>
      <td className="px-3 py-1.5">
        {entry.result === 'success' && (
          <span className="text-xs font-medium text-green-600 dark:text-green-400">Success</span>
        )}
        {entry.result === 'fail' && (
          <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
            <AlertTriangle size={12} /> Failed
          </span>
        )}
        {entry.result === 'pending' && (
          <span className="text-xs text-gray-400">Pending</span>
        )}
      </td>
    </tr>
  );
}

// ─── eisy Live Event Table ──────────────────────────────────

function EisyLiveTable({ entries }: { entries: EisyLiveEntry[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/95">
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Time</th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Type</th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Device</th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Event</th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Detail</th>
        </tr>
      </thead>
      <tbody>
        {entries.length === 0 && (
          <tr>
            <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
              No eisy events captured yet. Events will appear as the eisy logs device activity.
            </td>
          </tr>
        )}
        {entries.map((entry) => (
          <EisyLiveRow key={entry.id} entry={entry} />
        ))}
      </tbody>
    </table>
  );
}

function EisyLiveRow({ entry }: { entry: EisyLiveEntry }) {
  // Format timestamp: if we have a log timestamp, parse it; otherwise use the string
  let timeDisplay = entry.timestamp;
  const dateMatch = entry.timestamp.match(/(\d{4})\/(\d{2})\/(\d{2})\s(\d{2}:\d{2}:\d{2})/);
  if (dateMatch) {
    timeDisplay = `${dateMatch[2]}/${dateMatch[3]} ${dateMatch[4]}`;
  }

  const typeLabel = entry.isStatus ? 'status' : (entry.detail ?? 'event');
  const typeColor = entry.isStatus
    ? 'text-gray-400 dark:text-gray-500'
    : 'text-emerald-600 dark:text-emerald-400 font-medium';

  // Device: prefer name, show address as secondary
  const hasName = !!entry.deviceName;
  const devicePrimary = entry.deviceName ?? entry.device ?? '—';

  return (
    <tr className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/30 ${
      entry.isStatus ? 'opacity-60' : ''
    }`}
      title={entry.raw}
    >
      <td className="whitespace-nowrap px-3 py-1 font-mono text-[11px] text-gray-500 dark:text-gray-400">
        {timeDisplay}
      </td>
      <td className="px-3 py-1">
        <span className={`text-[11px] ${typeColor}`}>{typeLabel}</span>
      </td>
      <td className="px-3 py-1 text-gray-900 dark:text-gray-100" title={entry.raw}>
        <span className="text-xs">{devicePrimary}</span>
        {hasName && entry.device && (
          <span className="ml-1.5 text-[10px] text-gray-400 dark:text-gray-500">{entry.device}</span>
        )}
      </td>
      <td className="max-w-sm truncate px-3 py-1 text-xs text-gray-700 dark:text-gray-300" title={entry.action}>
        {entry.action}
      </td>
      <td className="px-3 py-1 text-[11px] text-gray-400 dark:text-gray-500">
        {!entry.isStatus && entry.detail}
      </td>
    </tr>
  );
}
