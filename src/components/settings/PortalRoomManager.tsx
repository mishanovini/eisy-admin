/**
 * Portal room manager — CRUD for Google Home rooms via portal API.
 *
 * Simple collapsible list with inline add/edit/delete.
 * Rooms are used to group spoken entries in Google Home.
 */
import { useState } from 'react';
import { Home, Plus, Edit3, Trash2, Check, X, Loader2 } from 'lucide-react';
import { usePortalStore } from '@/stores/portal-store.ts';
import { useConfirm } from '@/hooks/useConfirm.ts';
import { ConfirmDialog } from '@/components/common/ConfirmDialog.tsx';

export function PortalRoomManager() {
  const rooms = usePortalStore((s) => s.rooms);
  const createRoom = usePortalStore((s) => s.createRoom);
  const updateRoom = usePortalStore((s) => s.updateRoom);
  const deleteRoom = usePortalStore((s) => s.deleteRoom);

  const [expanded, setExpanded] = useState(false);
  const [addingName, setAddingName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialogProps, confirm] = useConfirm();

  const handleAdd = async () => {
    if (!addingName.trim()) return;
    setSaving(true);
    await createRoom(addingName.trim());
    setAddingName('');
    setIsAdding(false);
    setSaving(false);
  };

  const handleUpdate = async () => {
    if (!editId || !editName.trim()) return;
    setSaving(true);
    await updateRoom(editId, editName.trim());
    setEditId(null);
    setEditName('');
    setSaving(false);
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete room?',
      message: `Remove "${name}"? Devices in this room won't be deleted, but they'll lose their room assignment.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (ok) await deleteRoom(id);
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <ConfirmDialog {...dialogProps} />

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50"
      >
        <div className="flex items-center gap-2">
          <Home size={16} className="text-amber-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Rooms ({rooms.length})
          </h3>
        </div>
        <span className="text-xs text-gray-400">{expanded ? 'Hide' : 'Show'}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-800">
          {rooms.map((room) => (
            <div
              key={room._id}
              className="flex items-center justify-between border-b border-gray-50 px-4 py-2 last:border-0 dark:border-gray-800/50"
            >
              {editId === room._id ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUpdate()}
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    autoFocus
                  />
                  <button
                    onClick={handleUpdate}
                    disabled={saving}
                    className="rounded p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-sm text-gray-900 dark:text-gray-100">{room.name}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setEditId(room._id); setEditName(room.name); }}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800"
                      title="Rename"
                    >
                      <Edit3 size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(room._id, room.name)}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          {/* Add room */}
          {isAdding ? (
            <div className="flex items-center gap-2 px-4 py-2">
              <input
                type="text"
                value={addingName}
                onChange={(e) => setAddingName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="Room name..."
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                autoFocus
              />
              <button
                onClick={handleAdd}
                disabled={saving || !addingName.trim()}
                className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-50 dark:hover:bg-green-900/20"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
              <button
                onClick={() => { setIsAdding(false); setAddingName(''); }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="flex w-full items-center gap-1 px-4 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/10"
            >
              <Plus size={12} /> Add Room
            </button>
          )}

          {rooms.length === 0 && !isAdding && (
            <p className="px-4 py-3 text-center text-xs text-gray-400">
              No rooms yet. Add rooms to organize devices in Google Home.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
