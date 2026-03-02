/**
 * Voice Control settings — manage spoken names for voice assistants
 * (Google Home, Alexa, etc.).
 *
 * Spoken names are stored locally on the eisy in node notes XML.
 * Cloud sync with Google Home is managed through the my.isy.io portal.
 *
 * Architecture:
 *  - Loads all device spoken names from /rest/nodes/{addr}/notes in batches
 *  - Groups devices by protocol (Insteon, Z-Wave, Node Server)
 *  - Inline editing of spoken names with per-device save
 *  - Auto-fill from device names for bulk setup
 *  - Link to my.isy.io portal for Google Home cloud sync
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Mic,
  Search,
  X,
  Save,
  Check,
  Loader2,
  ExternalLink,
  RefreshCw,
  Wand2,
  AlertCircle,
} from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { fetchNodeNotes, saveNodeNotes } from '@/api/rest.ts';
import { getProtocolFamily } from '@/utils/address.ts';
import { getDeviceTypeInfo } from '@/utils/device-types.ts';
import { ICON_MAP } from '@/components/tree/icon-map.ts';
import { CircleDot } from 'lucide-react';
import type { IsyNode } from '@/api/types.ts';

// ─── Types ────────────────────────────────────────────────────

interface SpokenEntry {
  /** Value loaded from the eisy */
  original: string;
  /** Current value in the text input */
  current: string;
  /** Whether the notes are being loaded */
  loading: boolean;
  /** Whether the value is being saved */
  saving: boolean;
  /** Flash "saved" indicator */
  saved: boolean;
  /** Error message if save failed */
  error?: string;
}

type ProtocolGroup = 'insteon' | 'zwave' | 'nodeserver' | 'unknown';

const PROTOCOL_LABELS: Record<ProtocolGroup, string> = {
  insteon: 'Insteon Devices',
  zwave: 'Z-Wave Devices',
  nodeserver: 'Node Server Devices',
  unknown: 'Other Devices',
};

const PROTOCOL_ORDER: ProtocolGroup[] = ['insteon', 'zwave', 'nodeserver', 'unknown'];

// ─── Batch Loading ────────────────────────────────────────────

const BATCH_SIZE = 8;

// ─── Component ────────────────────────────────────────────────

export function VoiceControlSettings() {
  const nodes = useDeviceStore((s) => s.nodes);
  const [entries, setEntries] = useState<Map<string, SpokenEntry>>(new Map());
  const [search, setSearch] = useState('');
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
  const [loadingAll, setLoadingAll] = useState(false);
  const [autoFillCount, setAutoFillCount] = useState(0);
  const mountedRef = useRef(true);

  // ── Filter out scenes/folders — only show real device nodes ──
  const deviceNodes = useMemo(() => {
    return nodes.filter((n) => {
      // Skip nodes without a useful name
      if (!n.name || n.name.trim() === '') return false;
      return true;
    });
  }, [nodes]);

  // ── Group and sort by protocol ──
  const groupedNodes = useMemo(() => {
    const groups = new Map<ProtocolGroup, IsyNode[]>();
    for (const pg of PROTOCOL_ORDER) groups.set(pg, []);

    for (const node of deviceNodes) {
      const addr = String(node.address);
      const family = getProtocolFamily(addr);
      const group = groups.get(family) ?? groups.get('unknown')!;
      group.push(node);
    }

    // Sort alphabetically within each group
    for (const [, list] of groups) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return groups;
  }, [deviceNodes]);

  // ── Filter by search ──
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groupedNodes;

    const q = search.toLowerCase();
    const result = new Map<ProtocolGroup, IsyNode[]>();

    for (const [protocol, list] of groupedNodes) {
      const filtered = list.filter((n) => {
        const addr = String(n.address);
        const entry = entries.get(addr);
        return (
          n.name.toLowerCase().includes(q) ||
          addr.toLowerCase().includes(q) ||
          (entry?.current ?? '').toLowerCase().includes(q)
        );
      });
      result.set(protocol, filtered);
    }

    return result;
  }, [groupedNodes, search, entries]);

  // ── Total visible count ──
  const totalVisible = useMemo(() => {
    let count = 0;
    for (const [, list] of filteredGroups) count += list.length;
    return count;
  }, [filteredGroups]);

  // ── Count dirty entries (changed but not saved) ──
  const dirtyCount = useMemo(() => {
    let count = 0;
    for (const [, entry] of entries) {
      if (entry.current !== entry.original && !entry.saving) count++;
    }
    return count;
  }, [entries]);

  // ── Count devices with spoken names ──
  const spokenCount = useMemo(() => {
    let count = 0;
    for (const [, entry] of entries) {
      if (entry.current.trim() !== '') count++;
    }
    return count;
  }, [entries]);

  // ── Load all notes on mount ──
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadAllNotes = useCallback(async () => {
    if (deviceNodes.length === 0) return;

    setLoadingAll(true);
    setLoadProgress({ loaded: 0, total: deviceNodes.length });

    // Initialize entries with loading state
    const initial = new Map<string, SpokenEntry>();
    for (const node of deviceNodes) {
      initial.set(String(node.address), {
        original: '',
        current: '',
        loading: true,
        saving: false,
        saved: false,
      });
    }
    setEntries(initial);

    // Load in batches to avoid overwhelming the eisy
    let loaded = 0;
    for (let i = 0; i < deviceNodes.length; i += BATCH_SIZE) {
      if (!mountedRef.current) return;

      const batch = deviceNodes.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((n) => fetchNodeNotes(String(n.address))),
      );

      if (!mountedRef.current) return;

      setEntries((prev) => {
        const next = new Map(prev);
        for (let j = 0; j < batch.length; j++) {
          const node = batch[j];
          const result = results[j];
          if (!node || !result) continue;
          const addr = String(node.address);
          const spoken =
            result.status === 'fulfilled' && result.value?.spoken
              ? result.value.spoken
              : '';
          next.set(addr, {
            original: spoken,
            current: spoken,
            loading: false,
            saving: false,
            saved: false,
          });
        }
        return next;
      });

      loaded += batch.length;
      setLoadProgress({ loaded: Math.min(loaded, deviceNodes.length), total: deviceNodes.length });
    }

    setLoadingAll(false);
  }, [deviceNodes]);

  // Auto-load on mount when nodes are available
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (deviceNodes.length > 0 && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      void loadAllNotes();
    }
  }, [deviceNodes, loadAllNotes]);

  // ── Save a single device's spoken name ──
  const handleSave = useCallback(async (address: string) => {
    const entry = entries.get(address);
    if (!entry || entry.saving) return;

    setEntries((prev) => {
      const next = new Map(prev);
      next.set(address, { ...entry, saving: true, saved: false, error: undefined });
      return next;
    });

    const ok = await saveNodeNotes(address, { spoken: entry.current });

    if (!mountedRef.current) return;

    setEntries((prev) => {
      const next = new Map(prev);
      const current = next.get(address);
      if (!current) return prev;
      if (ok) {
        next.set(address, {
          ...current,
          original: current.current,
          saving: false,
          saved: true,
          error: undefined,
        });
        // Clear saved flash after 2s
        setTimeout(() => {
          if (!mountedRef.current) return;
          setEntries((p) => {
            const n = new Map(p);
            const c = n.get(address);
            if (c) n.set(address, { ...c, saved: false });
            return n;
          });
        }, 2000);
      } else {
        next.set(address, { ...current, saving: false, error: 'Save failed' });
      }
      return next;
    });
  }, [entries]);

  // ── Update a spoken name (local only, not saved yet) ──
  const handleChange = useCallback((address: string, value: string) => {
    setEntries((prev) => {
      const next = new Map(prev);
      const entry = next.get(address);
      if (!entry) return prev;
      next.set(address, { ...entry, current: value, saved: false, error: undefined });
      return next;
    });
  }, []);

  // ── Auto-fill from device names ──
  const handleAutoFill = useCallback(() => {
    let count = 0;
    setEntries((prev) => {
      const next = new Map(prev);
      for (const node of deviceNodes) {
        const addr = String(node.address);
        const entry = next.get(addr);
        if (entry && entry.current.trim() === '' && !entry.loading) {
          next.set(addr, { ...entry, current: node.name });
          count++;
        }
      }
      return next;
    });
    setAutoFillCount(count);
    setTimeout(() => setAutoFillCount(0), 3000);
  }, [deviceNodes]);

  // ── Save all dirty entries ──
  const handleSaveAll = useCallback(async () => {
    const dirtyAddresses: string[] = [];
    for (const [addr, entry] of entries) {
      if (entry.current !== entry.original && !entry.saving) {
        dirtyAddresses.push(addr);
      }
    }
    // Save in batches to avoid overwhelming the eisy
    for (let i = 0; i < dirtyAddresses.length; i += BATCH_SIZE) {
      const batch = dirtyAddresses.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((addr) => handleSave(addr)));
    }
  }, [entries, handleSave]);

  // ── Render ──

  return (
    <div className="space-y-4">
      {/* Header / Info Card */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Mic size={16} className="text-purple-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Voice Control</h3>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Manage spoken names for voice assistants like Google Home and Alexa.
            Spoken names are stored on the eisy and tell voice assistants what to call each device.
          </p>
          <div className="flex items-center gap-3 rounded-lg bg-blue-50 px-3 py-2.5 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
            <ExternalLink size={14} className="shrink-0" />
            <span>
              After setting spoken names here, sync with Google Home via the{' '}
              <a
                href="https://my.isy.io"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2 hover:text-blue-600 dark:hover:text-blue-200"
              >
                ISY Portal (my.isy.io)
              </a>{' '}
              to update cloud-connected voice assistants.
            </span>
          </div>
          {/* Stats row */}
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            <span>{deviceNodes.length} devices</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span>{spokenCount} with spoken names</span>
            {dirtyCount > 0 && (
              <>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span className="text-amber-600 dark:text-amber-400">{dirtyCount} unsaved</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Toolbar: Search + Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search devices or spoken names..."
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-8 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Action buttons */}
        <button
          onClick={handleAutoFill}
          disabled={loadingAll}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          title="Set spoken name to device name for all devices without one"
        >
          <Wand2 size={13} /> Auto-fill empty
        </button>

        {dirtyCount > 0 && (
          <button
            onClick={() => void handleSaveAll()}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
          >
            <Save size={13} /> Save all ({dirtyCount})
          </button>
        )}

        <button
          onClick={() => { hasLoadedRef.current = false; void loadAllNotes(); }}
          disabled={loadingAll}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          title="Reload all spoken names from eisy"
        >
          <RefreshCw size={13} className={loadingAll ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Auto-fill notification */}
      {autoFillCount > 0 && (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-400">
          Auto-filled {autoFillCount} device{autoFillCount !== 1 ? 's' : ''}. Click &quot;Save all&quot; to write changes to the eisy.
        </div>
      )}

      {/* Loading progress */}
      {loadingAll && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Loader2 size={12} className="animate-spin" />
            Loading spoken names... {loadProgress.loaded}/{loadProgress.total}
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full rounded-full bg-purple-500 transition-all duration-300"
              style={{ width: `${loadProgress.total > 0 ? (loadProgress.loaded / loadProgress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Device list grouped by protocol */}
      <div className="space-y-3">
        {PROTOCOL_ORDER.map((protocol) => {
          const list = filteredGroups.get(protocol) ?? [];
          if (list.length === 0) return null;

          return (
            <div
              key={protocol}
              className="rounded-xl border border-gray-200 dark:border-gray-700"
            >
              {/* Group header */}
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/80">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {PROTOCOL_LABELS[protocol]}
                </span>
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                  {list.length}
                </span>
              </div>

              {/* Device rows */}
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {list.map((node) => (
                  <DeviceRow
                    key={String(node.address)}
                    node={node}
                    entry={entries.get(String(node.address))}
                    onChange={handleChange}
                    onSave={handleSave}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {totalVisible === 0 && !loadingAll && (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <Mic size={24} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {search ? 'No devices match your search.' : 'No devices found.'}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Device Row Component ─────────────────────────────────────

interface DeviceRowProps {
  node: IsyNode;
  entry: SpokenEntry | undefined;
  onChange: (address: string, value: string) => void;
  onSave: (address: string) => void;
}

function DeviceRow({ node, entry, onChange, onSave }: DeviceRowProps) {
  const address = String(node.address);
  const typeInfo = getDeviceTypeInfo(node['@_nodeDefId'], node.type ? String(node.type) : undefined);
  const isDirty = entry && entry.current !== entry.original && !entry.saving;
  const Icon = ICON_MAP[typeInfo.icon] ?? CircleDot;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {/* Device info */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Icon
          size={14}
          className="shrink-0 text-gray-400 dark:text-gray-500"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {node.name}
          </div>
          <div className="truncate text-[11px] text-gray-400 dark:text-gray-500">
            {typeInfo.label} &middot; {address}
          </div>
        </div>
      </div>

      {/* Spoken name input */}
      <div className="flex items-center gap-1.5">
        {entry?.loading ? (
          <div className="flex h-[30px] w-48 items-center justify-center rounded border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
            <Loader2 size={12} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <input
            type="text"
            value={entry?.current ?? ''}
            onChange={(e) => onChange(address, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isDirty) {
                void onSave(address);
              }
            }}
            placeholder="Spoken name..."
            className={`h-[30px] w-48 rounded border px-2 text-sm transition-colors ${
              isDirty
                ? 'border-amber-300 bg-amber-50 text-gray-900 dark:border-amber-600 dark:bg-amber-900/20 dark:text-gray-100'
                : 'border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
            } placeholder-gray-400 focus:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-300 dark:placeholder-gray-500`}
          />
        )}

        {/* Save / status button */}
        <div className="flex w-8 items-center justify-center">
          {entry?.saving ? (
            <Loader2 size={14} className="animate-spin text-purple-500" />
          ) : entry?.saved ? (
            <Check size={14} className="text-green-500" />
          ) : entry?.error ? (
            <span title={entry.error}><AlertCircle size={14} className="text-red-500" /></span>
          ) : isDirty ? (
            <button
              onClick={() => void onSave(address)}
              className="rounded p-0.5 text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20"
              title="Save spoken name (or press Enter)"
            >
              <Save size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
