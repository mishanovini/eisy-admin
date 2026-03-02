/**
 * Portal spoken entry list — manage Google Home voice names via portal API.
 *
 * Displays all spoken entries grouped by room, with inline editing,
 * search/filter, and sync-to-Google-Home button.
 * Uses AddSpokenModal for the 3-step device picker flow.
 */
import { useState, useMemo, useCallback } from 'react';
import {
  Search,
  X,
  Plus,
  Trash2,
  Check,
  Loader2,
  RefreshCw,
  Upload,
  Mic,
  Edit3,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { usePortalStore } from '@/stores/portal-store.ts';
import type { PortalSpokenNode, SpokenNodePayload } from '@/stores/portal-store.ts';
import { useConfirm } from '@/hooks/useConfirm.ts';
import { ConfirmDialog } from '@/components/common/ConfirmDialog.tsx';
import { AddSpokenModal } from './AddSpokenModal.tsx';

// ─── Constants ────────────────────────────────────────────────

const USER_CAT_OPTIONS: { value: string; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'switch', label: 'Switch' },
  { value: 'outlet', label: 'Outlet' },
  { value: 'fan', label: 'Fan' },
  { value: 'lock', label: 'Lock' },
  { value: 'scene', label: 'Scene' },
  { value: 'openClose', label: 'Open/Close' },
];

// ─── Types ────────────────────────────────────────────────────

interface EditingState {
  id: string;
  spoken: string[];
  room: string;
  userCat: string;
  saving: boolean;
}

// ─── Component ────────────────────────────────────────────────

export function PortalSpokenList() {
  const spokens = usePortalStore((s) => s.spokens);
  const rooms = usePortalStore((s) => s.rooms);
  const credentials = usePortalStore((s) => s.credentials);
  const loading = usePortalStore((s) => s.loading);
  const syncing = usePortalStore((s) => s.syncing);
  const fetchAll = usePortalStore((s) => s.fetchAll);
  const updateSpoken = usePortalStore((s) => s.updateSpoken);
  const deleteSpoken = usePortalStore((s) => s.deleteSpoken);
  const syncToGoogle = usePortalStore((s) => s.syncToGoogle);

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(new Set());
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [dialogProps, confirm] = useConfirm();

  // ── Room lookup map ──
  const roomMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rooms) map.set(r._id, r.name);
    return map;
  }, [rooms]);

  // ── Filter + group by room ──
  const filtered = useMemo(() => {
    if (!search.trim()) return spokens;
    const q = search.toLowerCase();
    return spokens.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.spoken.some((w) => w.toLowerCase().includes(q)) ||
        s.address.toLowerCase().includes(q),
    );
  }, [spokens, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, PortalSpokenNode[]>();
    for (const s of filtered) {
      const roomName = s.room ? (roomMap.get(s.room) ?? 'Unknown Room') : 'No Room';
      if (!groups.has(roomName)) groups.set(roomName, []);
      groups.get(roomName)!.push(s);
    }
    // Sort rooms alphabetically, but "No Room" last
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === 'No Room') return 1;
      if (b[0] === 'No Room') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered, roomMap]);

  // ── Room collapse toggle ──
  const toggleRoom = useCallback((roomName: string) => {
    setCollapsedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(roomName)) next.delete(roomName);
      else next.add(roomName);
      return next;
    });
  }, []);

  // ── Start editing ──
  const startEdit = (node: PortalSpokenNode) => {
    setEditing({
      id: node._id,
      spoken: [...node.spoken],
      room: node.room ?? '',
      userCat: node.userCat,
      saving: false,
    });
  };

  // ── Save edit ──
  const saveEdit = async (node: PortalSpokenNode) => {
    if (!editing || !credentials) return;
    setEditing((e) => e && { ...e, saving: true });

    const payload: SpokenNodePayload = {
      id: node._id,
      address: node.address,
      spoken: editing.spoken[0] ?? '',
      spoken2: editing.spoken[1],
      spoken3: editing.spoken[2],
      spoken4: editing.spoken[3],
      spoken5: editing.spoken[4],
      room: editing.room,
      category: node.category,
      userCat: editing.userCat,
      uuid: credentials.uuid,
      domain: credentials.domain,
    };
    if (node.turnOnValue !== undefined) payload.turnon_value = node.turnOnValue;
    if (node.turnOffValue !== undefined) payload.turnoff_value = node.turnOffValue;
    if (node.colorMfr) payload.colorMfr = node.colorMfr;

    await updateSpoken(payload);
    setEditing(null);
  };

  // ── Delete entry ──
  const handleDelete = async (node: PortalSpokenNode) => {
    const ok = await confirm({
      title: 'Delete spoken entry?',
      message: `Remove "${node.name}" from Google Home? This won't take effect until you sync.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (ok) await deleteSpoken(node._id);
  };

  // ── Sync to Google Home ──
  const handleSync = async () => {
    const ok = await syncToGoogle();
    setSyncResult(ok ? 'Synced to Google Home!' : 'Sync failed — check the activity log');
    setTimeout(() => setSyncResult(null), 4000);
  };

  if (!credentials) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConfirmDialog {...dialogProps} />

      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search spoken names or addresses..."
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-9 pr-8 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>

        <button
          onClick={() => fetchAll()}
          disabled={loading}
          className="flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>

        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          <Plus size={12} /> Add Entry
        </button>

        <button
          onClick={handleSync}
          disabled={syncing || spokens.length === 0}
          className="flex items-center gap-1 rounded bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {syncing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Sync to Google Home
        </button>
      </div>

      {syncResult && (
        <p className={`pb-1 text-xs font-medium ${syncResult.includes('failed') ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
          {syncResult}
        </p>
      )}

      {/* Stats */}
      <p className="pb-2 text-xs text-gray-500 dark:text-gray-400">
        {spokens.length} spoken {spokens.length === 1 ? 'entry' : 'entries'} · {rooms.length} rooms
        {search && ` · ${filtered.length} matching`}
      </p>

      {/* Loading state */}
      {loading && spokens.length === 0 && (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
          <span className="ml-2 text-sm">Loading voice entries...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && spokens.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center dark:border-gray-600">
          <Mic size={24} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No spoken entries yet</p>
          <p className="mt-1 text-xs text-gray-400">Add entries to control your devices with Google Home</p>
        </div>
      )}

      {/* Scrollable grouped entries */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {grouped.map(([roomName, nodes]) => (
          <div key={roomName} className="rounded-xl border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleRoom(roomName)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              {collapsedRooms.has(roomName) ? (
                <ChevronRight size={14} className="text-gray-400" />
              ) : (
                <ChevronDown size={14} className="text-gray-400" />
              )}
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{roomName}</span>
              <span className="text-xs text-gray-400">({nodes.length})</span>
            </button>

            {!collapsedRooms.has(roomName) && (
              <div className="border-t border-gray-100 dark:border-gray-800">
                {nodes.map((node) => (
                  <SpokenRow
                    key={node._id}
                    node={node}
                    editing={editing?.id === node._id ? editing : null}
                    rooms={rooms}
                    onEdit={() => startEdit(node)}
                    onSave={() => saveEdit(node)}
                    onCancel={() => setEditing(null)}
                    onDelete={() => handleDelete(node)}
                    onSpokenChange={(idx, val) => {
                      setEditing((e) => {
                        if (!e) return null;
                        const spoken = [...e.spoken];
                        spoken[idx] = val;
                        return { ...e, spoken };
                      });
                    }}
                    onRoomChange={(room) => setEditing((e) => e && { ...e, room })}
                    onCatChange={(userCat) => setEditing((e) => e && { ...e, userCat })}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add entry modal */}
      {showAdd && <AddSpokenModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// ─── Spoken Row ───────────────────────────────────────────────

function SpokenRow({
  node,
  editing,
  rooms,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onSpokenChange,
  onRoomChange,
  onCatChange,
}: {
  node: PortalSpokenNode;
  editing: EditingState | null;
  rooms: { _id: string; name: string }[];
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onSpokenChange: (idx: number, val: string) => void;
  onRoomChange: (room: string) => void;
  onCatChange: (cat: string) => void;
}) {
  const isEditing = editing !== null;

  return (
    <div className="flex items-start gap-3 border-b border-gray-50 px-4 py-2.5 last:border-0 dark:border-gray-800/50">
      {/* Device info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{node.name}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {node.address}
          </span>
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
            {node.userCat}
          </span>
        </div>

        {isEditing ? (
          <div className="mt-2 space-y-2">
            {/* Spoken names — with label */}
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Spoken Names
              </label>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 5 }, (_, i) => (
                  <input
                    key={i}
                    type="text"
                    value={editing.spoken[i] ?? ''}
                    onChange={(e) => onSpokenChange(i, e.target.value)}
                    placeholder={i === 0 ? 'Primary' : `Alt ${i + 1}`}
                    className={`rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 ${
                      i === 0 ? 'w-44' : 'w-32'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Room + Category — with labels */}
            <div className="flex gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Room
                </label>
                <select
                  value={editing.room}
                  onChange={(e) => onRoomChange(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">No Room</option>
                  {rooms.map((r) => (
                    <option key={r._id} value={r._id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Google Home Type
                </label>
                <select
                  value={editing.userCat}
                  onChange={(e) => onCatChange(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  {USER_CAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {node.spoken.filter(Boolean).map((s, i) => (
              <span
                key={i}
                className={`rounded px-1.5 py-0.5 text-xs ${
                  i === 0
                    ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400'
                    : 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                "{s}"
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex shrink-0 gap-1 pt-0.5">
        {isEditing ? (
          <>
            <button
              onClick={onSave}
              disabled={editing.saving}
              className="rounded p-1.5 text-green-600 hover:bg-green-50 disabled:opacity-50 dark:hover:bg-green-900/20"
              title="Save"
            >
              {editing.saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
            <button
              onClick={onCancel}
              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Cancel"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onEdit}
              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800"
              title="Edit"
            >
              <Edit3 size={14} />
            </button>
            <button
              onClick={onDelete}
              className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
