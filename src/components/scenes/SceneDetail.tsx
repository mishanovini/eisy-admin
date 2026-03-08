/**
 * Scene detail panel — members, roles, per-device on-level/ramp-rate config.
 *
 * Redesigned to match the UDAC scene editor functionality:
 * - "All On" / "All Off" instead of Activate/Deactivate
 * - Additional scene control buttons (Fast On/Off, Brighten, Dim, etc.)
 * - Per-responder on-level and ramp-rate configuration table
 * - Controllers shown separately (read-only on-level display)
 * - Add/Remove member via header buttons → modal device pickers
 *
 * Scene-specific OL/RR are fetched via SOAP DeviceSpecific G_SP command,
 * which returns per-member on-level and ramp-rate for THIS scene specifically.
 * These are independent of the device's own OL/RR (which affect its local behavior).
 * Changes are applied via SOAP S_OL_SP / S_RR_SP commands.
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Layers,
  Power,
  PowerOff,
  Zap,
  ZapOff,
  ChevronsUp,
  ChevronsDown,
  StopCircle,
  Search,
  Users,
  Settings2,
  Loader2,
  Plus,
  Minus,
  X,
  Trash2,
} from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useStatusStore } from '@/stores/status-store.ts';
import { sendNodeCommand } from '@/api/rest.ts';
import { moveNode, removeFromGroup, getSceneProperties } from '@/api/soap.ts';
import { useSceneWriteStore } from '@/stores/scene-write-store.ts';
import { CMD } from '@/api/types.ts';
import type { IsyProperty } from '@/api/types.ts';
import { getDeviceTypeInfo } from '@/utils/device-types.ts';
import { formatPropertyValue } from '@/utils/labels.ts';
import {
  formatSceneAction,
  formatOnLevel,
  getOnLevelOptions,
  getRampRateOptions,
  percentToOnLevel,
  getSceneMembers,
  getControllerAddresses,
} from '@/utils/scene-utils.ts';
import type { SceneMember } from '@/utils/scene-utils.ts';
import { ICON_MAP } from '@/components/tree/icon-map.ts';
import { ConfirmDialog } from '@/components/common/ConfirmDialog.tsx';
import { useConfirm } from '@/hooks/useConfirm.ts';

interface SceneDetailProps {
  address: string;
}

export function SceneDetail({ address }: SceneDetailProps) {
  const scene = useDeviceStore((s) => s.getScene(address));
  const nodeMap = useDeviceStore((s) => s.nodeMap);
  const getProperty = useStatusStore((s) => s.getProperty);
  const [pending, setPending] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);

  // Scene-specific OL/RR — fetched via SOAP G_SP (independent of device-level OL/RR)
  const [scenePropsMap, setScenePropsMap] = useState<Map<string, { onLevel: number; rampRate: number }>>(new Map());
  const [loadingSceneProps, setLoadingSceneProps] = useState(false);

  // Fetch scene-specific properties when address changes
  const fetchSceneProps = useCallback(async (sceneAddr: string) => {
    setLoadingSceneProps(true);
    try {
      const props = await getSceneProperties(sceneAddr);
      const map = new Map<string, { onLevel: number; rampRate: number }>();
      for (const p of props) {
        map.set(p.node, { onLevel: p.onLevel, rampRate: p.rampRate });
      }
      setScenePropsMap(map);
    } catch {
      // If SOAP fails, keep empty map — rows will show defaults
    } finally {
      setLoadingSceneProps(false);
    }
  }, []);

  useEffect(() => {
    if (address) {
      fetchSceneProps(address);
    }
  }, [address, fetchSceneProps]);

  /** Update local scene props optimistically after a save */
  const updateSceneProp = useCallback(
    (memberAddr: string, patch: Partial<{ onLevel: number; rampRate: number }>) => {
      setScenePropsMap((prev) => {
        const next = new Map(prev);
        const existing = next.get(memberAddr) ?? { onLevel: 255, rampRate: 28 };
        next.set(memberAddr, { ...existing, ...patch });
        return next;
      });
    },
    [],
  );

  if (!scene) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400 dark:text-gray-500">Scene not found.</p>
      </div>
    );
  }

  const members = getSceneMembers(scene, nodeMap);
  const controllers = members.filter((m) => m.role === 'controller');
  const responders = members.filter((m) => m.role === 'responder');
  const memberAddresses = new Set(members.map((m) => m.address));

  const sendCommand = async (cmd: string) => {
    setPending(true);
    try {
      await sendNodeCommand(address, cmd);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 dark:bg-purple-900/20">
          <Layers size={24} className="text-purple-600 dark:text-purple-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {scene.name}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Scene &middot; {members.length} member{members.length !== 1 ? 's' : ''}
            {controllers.length > 0 && ` (${controllers.length} controller${controllers.length !== 1 ? 's' : ''}, ${responders.length} responder${responders.length !== 1 ? 's' : ''})`}
          </p>
        </div>
        {/* Add / Remove Member buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-purple-300 px-3 py-1.5 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-50 dark:border-purple-600 dark:text-purple-400 dark:hover:bg-purple-900/20"
          >
            <Plus size={14} />
            Add
          </button>
          {members.length > 0 && (
            <button
              onClick={() => setShowRemoveModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <Minus size={14} />
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Scene Controls */}
      <div className="space-y-2">
        {/* Primary controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => sendCommand(CMD.DON)}
            disabled={pending}
            className="flex items-center gap-1.5 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            <Power size={16} /> All On
          </button>
          <button
            onClick={() => sendCommand(CMD.DOF)}
            disabled={pending}
            className="flex items-center gap-1.5 rounded bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            <PowerOff size={16} /> All Off
          </button>
        </div>
        {/* Secondary controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => sendCommand(CMD.DFON)}
            disabled={pending}
            className="flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            title="Fast On — instantly turn on all devices (no ramp)"
          >
            <Zap size={12} /> Fast On
          </button>
          <button
            onClick={() => sendCommand(CMD.DFOF)}
            disabled={pending}
            className="flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            title="Fast Off — instantly turn off all devices (no ramp)"
          >
            <ZapOff size={12} /> Fast Off
          </button>
          <button
            onClick={() => sendCommand(CMD.FDUP)}
            disabled={pending}
            className="flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            title="Brighten — gradually increase brightness"
          >
            <ChevronsUp size={12} /> Brighten
          </button>
          <button
            onClick={() => sendCommand(CMD.FDDOWN)}
            disabled={pending}
            className="flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            title="Dim — gradually decrease brightness"
          >
            <ChevronsDown size={12} /> Dim
          </button>
          <button
            onClick={() => sendCommand(CMD.FDSTOP)}
            disabled={pending}
            className="flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            title="Stop — stop any in-progress fade/ramp"
          >
            <StopCircle size={12} /> Stop
          </button>
          <button
            onClick={() => sendCommand(CMD.QUERY)}
            disabled={pending}
            className="flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            title="Query — refresh status of all scene members"
          >
            <Search size={12} /> Query
          </button>
        </div>
      </div>

      {/* Controllers — with read-only status display (shown first) */}
      {controllers.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <Users size={14} /> Controllers
          </h3>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Device</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">On Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {controllers.map((member) => (
                  <ControllerRow
                    key={member.address}
                    member={member}
                    getProperty={getProperty}
                    sceneOnLevel={scenePropsMap.get(member.address)?.onLevel}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Responders — with on-level and ramp-rate configuration */}
      {responders.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <Settings2 size={14} /> Responders
          </h3>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Device</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">On Level</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Ramp Rate</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {responders.map((member) => (
                  <ResponderRow
                    key={member.address}
                    member={member}
                    sceneAddress={address}
                    sceneName={scene.name}
                    sceneOnLevel={scenePropsMap.get(member.address)?.onLevel ?? 255}
                    sceneRampRate={scenePropsMap.get(member.address)?.rampRate ?? 28}
                    loadingSceneProps={loadingSceneProps}
                    getProperty={getProperty}
                    onScenePropChanged={updateSceneProp}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {members.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-600">
          <p className="text-sm text-gray-400 dark:text-gray-500">No members in this scene.</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <Plus size={14} />
            Add Member
          </button>
        </div>
      )}

      {/* Add Member Modal */}
      <AddMemberModal
        open={showAddModal}
        sceneName={scene.name}
        sceneAddress={String(scene.address)}
        existingMemberAddresses={memberAddresses}
        onClose={() => setShowAddModal(false)}
      />

      {/* Remove Member Modal */}
      <RemoveMemberModal
        open={showRemoveModal}
        sceneName={scene.name}
        sceneAddress={String(scene.address)}
        members={members}
        onClose={() => setShowRemoveModal(false)}
      />
    </div>
  );
}

/* ─── Types ───────────────────────────────────────────────── */

type GetPropertyFn = (addr: string, propId: string) => IsyProperty | undefined;

/* ─── Add Member Modal ─────────────────────────────────────── */

function AddMemberModal({
  open,
  sceneName,
  sceneAddress,
  existingMemberAddresses,
  onClose,
}: {
  open: boolean;
  sceneName: string;
  sceneAddress: string;
  existingMemberAddresses: Set<string>;
  onClose: () => void;
}) {
  const nodes = useDeviceStore((s) => s.nodes);
  const scenes = useDeviceStore((s) => s.scenes);
  const fetchAll = useDeviceStore((s) => s.fetchAll);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmProps, confirm] = useConfirm();

  // Devices that are already a controller in any scene — can't be controller again
  const existingControllers = useMemo(() => getControllerAddresses(scenes), [scenes]);

  // Filter to devices NOT already in the scene
  const availableDevices = useMemo(() => {
    const lf = filter.toLowerCase();
    return nodes
      .filter((n) => {
        const addr = String(n.address);
        if (existingMemberAddresses.has(addr)) return false;
        if (lf && !n.name.toLowerCase().includes(lf) && !addr.toLowerCase().includes(lf)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [nodes, existingMemberAddresses, filter]);

  const handleAdd = async (deviceAddr: string, deviceName: string, role: 'controller' | 'responder') => {
    const ok = await confirm({
      title: 'Add to Scene',
      message: `Add "${deviceName}" to "${sceneName}" as a ${role}?`,
      confirmLabel: 'Add',
      variant: 'warning',
    });
    if (!ok) return;

    setAdding(deviceAddr);
    setError('');
    try {
      const result = await moveNode(deviceAddr, sceneAddress, role);
      if (result.success) {
        await fetchAll();
      } else {
        setError(result.info ?? 'Failed to add device to scene.');
      }
    } finally {
      setAdding(null);
    }
  };

  const handleClose = () => {
    setFilter('');
    setError('');
    setAdding(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div
        className="relative mx-4 flex w-full max-w-md flex-col rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
        style={{ maxHeight: '70vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Add Member to &ldquo;{sceneName}&rdquo;
          </h3>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <X size={16} />
          </button>
        </div>

        {/* Filter */}
        <div className="border-b border-gray-200 px-5 py-2 dark:border-gray-700">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter devices..."
              autoFocus
              className="w-full rounded-lg border border-gray-300 bg-transparent py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Device list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {availableDevices.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-400">
              {filter
                ? 'No matching devices available.'
                : existingMemberAddresses.size > 0
                  ? 'All devices are already members of this scene.'
                  : 'No devices found.'}
            </p>
          ) : (
            availableDevices.map((node) => {
              const addr = String(node.address);
              const typeInfo = getDeviceTypeInfo(node['@_nodeDefId'], node.type ? String(node.type) : undefined);
              const IconComponent = ICON_MAP[typeInfo.icon];
              const isAdding = adding === addr;
              const controllerBlocked = existingControllers.has(addr);

              return (
                <div
                  key={addr}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className="flex-shrink-0">
                    {IconComponent && <IconComponent size={14} className="text-gray-500 dark:text-gray-400" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
                    {node.name}
                  </span>
                  {controllerBlocked && (
                    <span className="flex-shrink-0 text-[10px] text-amber-600 dark:text-amber-400" title="Already a controller in another scene">
                      ctrl in use
                    </span>
                  )}
                  <button
                    onClick={() => handleAdd(addr, node.name, 'responder')}
                    disabled={isAdding}
                    className="flex-shrink-0 rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                    title="Add as responder"
                  >
                    {isAdding ? <Loader2 size={10} className="animate-spin" /> : 'Responder'}
                  </button>
                  {!controllerBlocked && (
                    <button
                      onClick={() => handleAdd(addr, node.name, 'controller')}
                      disabled={isAdding}
                      className="flex-shrink-0 rounded border border-blue-300 px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-600 dark:text-blue-400 dark:hover:bg-blue-900/20"
                      title="Add as controller"
                    >
                      {isAdding ? <Loader2 size={10} className="animate-spin" /> : 'Controller'}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <button
            onClick={handleClose}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Done
          </button>
        </div>

        <ConfirmDialog {...confirmProps} />
      </div>
    </div>
  );
}

/* ─── Remove Member Modal ──────────────────────────────────── */

function RemoveMemberModal({
  open,
  sceneName,
  sceneAddress,
  members,
  onClose,
}: {
  open: boolean;
  sceneName: string;
  sceneAddress: string;
  members: SceneMember[];
  onClose: () => void;
}) {
  const fetchAll = useDeviceStore((s) => s.fetchAll);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmProps, confirm] = useConfirm();

  const handleRemove = async (memberAddr: string, memberName: string) => {
    const ok = await confirm({
      title: 'Remove from Scene',
      message: `Remove "${memberName}" from "${sceneName}"? The device will no longer respond to this scene's commands.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;

    setRemoving(memberAddr);
    setError('');
    try {
      const result = await removeFromGroup(memberAddr, sceneAddress);
      if (result.success) {
        await fetchAll();
        // Auto-close if no members left
        const remaining = members.filter((m) => m.address !== memberAddr);
        if (remaining.length === 0) {
          handleClose();
        }
      } else {
        setError(result.info ?? 'Failed to remove device from scene.');
      }
    } finally {
      setRemoving(null);
    }
  };

  const handleClose = () => {
    setError('');
    setRemoving(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div
        className="relative mx-4 flex w-full max-w-md flex-col rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
        style={{ maxHeight: '70vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Remove Member from &ldquo;{sceneName}&rdquo;
          </h3>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <X size={16} />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Member list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {members.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-400">
              No members to remove.
            </p>
          ) : (
            members.map((member) => {
              const typeInfo = getDeviceTypeInfo(member.nodeDefId, member.nodeType);
              const IconComponent = ICON_MAP[typeInfo.icon];
              const isRemoving = removing === member.address;

              return (
                <div
                  key={member.address}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className="flex-shrink-0">
                    {IconComponent && <IconComponent size={14} className="text-gray-500 dark:text-gray-400" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
                    {member.name}
                  </span>
                  <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    member.role === 'controller'
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                  }`}>
                    {member.role}
                  </span>
                  <button
                    onClick={() => handleRemove(member.address, member.name)}
                    disabled={isRemoving}
                    className="flex-shrink-0 rounded border border-red-300 p-1 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-900/20"
                    title={`Remove ${member.name}`}
                  >
                    {isRemoving ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <button
            onClick={handleClose}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Done
          </button>
        </div>

        <ConfirmDialog {...confirmProps} />
      </div>
    </div>
  );
}

/* ─── Responder Row (with editable scene-specific on-level/ramp-rate) ── */

/**
 * Displays and edits the scene-specific OL and RR for a responder member.
 *
 * Scene-specific values come from the SOAP G_SP command (passed in as props),
 * NOT from the device's own OL/RR in the status store. Device status (ST)
 * still comes from the status store since it's a device-level property.
 *
 * Changes are non-blocking: they're pushed to the scene-write-store queue,
 * the UI updates optimistically, and toasts show write progress.
 */
function ResponderRow({
  member,
  sceneAddress,
  sceneName,
  sceneOnLevel,
  sceneRampRate,
  loadingSceneProps,
  getProperty,
  onScenePropChanged,
}: {
  member: SceneMember;
  sceneAddress: string;
  sceneName: string;
  /** Scene-specific on-level for this member (0-255) */
  sceneOnLevel: number;
  /** Scene-specific ramp rate index for this member (0-31) */
  sceneRampRate: number;
  /** True while initial scene properties are being fetched */
  loadingSceneProps: boolean;
  getProperty: GetPropertyFn;
  /** Optimistically update the parent's scene props map */
  onScenePropChanged: (addr: string, patch: Partial<{ onLevel: number; rampRate: number }>) => void;
}) {
  const enqueue = useSceneWriteStore((s) => s.enqueue);
  // Boolean selectors — `.some()` returns a primitive, avoiding the infinite
  // re-render loop that `.filter()` causes (new array ref on every render →
  // Object.is fails → useSyncExternalStore detects "change" → re-render → repeat).
  const hasPendingWrites = useSceneWriteStore((s) =>
    s.entries.some(
      (e) =>
        e.memberAddr === member.address &&
        e.sceneAddr === sceneAddress &&
        (e.status === 'pending' || e.status === 'writing'),
    ),
  );
  const isWriting = useSceneWriteStore((s) =>
    s.entries.some(
      (e) =>
        e.memberAddr === member.address &&
        e.sceneAddr === sceneAddress &&
        e.status === 'writing',
    ),
  );

  const typeInfo = getDeviceTypeInfo(member.nodeDefId, member.nodeType);
  const IconComponent = ICON_MAP[typeInfo.icon];

  // Device status (ST) is device-level — always from the status store
  const stProp = getProperty(member.address, 'ST');
  const status = stProp ? formatPropertyValue(stProp, typeInfo.category) : 'Unknown';

  // Only dimmers have a meaningful ramp rate. Keypad buttons, relays, switches,
  // outlets, locks, etc. don't ramp — their RR property is meaningless even if present.
  const hasRampRate = typeInfo.category === 'dimmer';

  const onLevelOptions = getOnLevelOptions();
  const rampRateOptions = getRampRateOptions();

  const handleOnLevelChange = useCallback((newPercent: number) => {
    const newLevel = percentToOnLevel(newPercent);
    // Optimistic UI update
    onScenePropChanged(member.address, { onLevel: newLevel });
    // Queue the SOAP write (non-blocking)
    enqueue(member.address, member.name, sceneAddress, sceneName, 'onLevel', newLevel);
  }, [member.address, member.name, sceneAddress, sceneName, onScenePropChanged, enqueue]);

  const handleRampRateChange = useCallback((newIndex: number) => {
    // Optimistic UI update
    onScenePropChanged(member.address, { rampRate: newIndex });
    // Queue the SOAP write (non-blocking)
    enqueue(member.address, member.name, sceneAddress, sceneName, 'rampRate', newIndex);
  }, [member.address, member.name, sceneAddress, sceneName, onScenePropChanged, enqueue]);

  // Row styling: purple left border + tinted background when writes are queued/active
  const rowClass = hasPendingWrites
    ? 'border-l-2 border-l-purple-400 bg-purple-50/50 dark:border-l-purple-500 dark:bg-purple-900/10'
    : 'hover:bg-gray-50 dark:hover:bg-gray-800/30';

  return (
    <tr className={rowClass}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0">
            {IconComponent && (
              <IconComponent size={14} className={hasPendingWrites ? 'text-purple-500 dark:text-purple-400' : 'text-gray-500 dark:text-gray-400'} />
            )}
          </span>
          <span className="truncate font-medium text-gray-900 dark:text-gray-100">
            {member.name}
          </span>
          {isWriting && (
            <Loader2 size={10} className="flex-shrink-0 animate-spin text-purple-500" />
          )}
          {hasPendingWrites && !isWriting && (
            <span className="flex-shrink-0 rounded bg-purple-100 px-1 py-0.5 text-[9px] font-medium text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
              queued
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
        {status}
      </td>
      <td className="px-3 py-2">
        {loadingSceneProps ? (
          <Loader2 size={12} className="animate-spin text-gray-400" />
        ) : (
          <select
            value={findClosestPercent(sceneOnLevel, onLevelOptions)}
            onChange={(e) => handleOnLevelChange(parseInt(e.target.value, 10))}
            className={`rounded border px-1.5 py-1 text-xs ${
              hasPendingWrites
                ? 'border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-600 dark:bg-purple-900/20 dark:text-purple-300'
                : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {onLevelOptions.map((opt) => (
              <option key={opt.percent} value={opt.percent}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="px-3 py-2">
        {loadingSceneProps ? (
          <Loader2 size={12} className="animate-spin text-gray-400" />
        ) : hasRampRate ? (
          <select
            value={sceneRampRate}
            onChange={(e) => handleRampRateChange(parseInt(e.target.value, 10))}
            className={`rounded border px-1.5 py-1 text-xs ${
              hasPendingWrites
                ? 'border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-600 dark:bg-purple-900/20 dark:text-purple-300'
                : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {rampRateOptions.map((opt) => (
              <option key={opt.index} value={opt.index}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <span className={`text-xs ${hasPendingWrites ? 'text-purple-600 dark:text-purple-400' : 'text-gray-600 dark:text-gray-400'}`}>
          {loadingSceneProps ? '...' : hasRampRate ? formatSceneAction(sceneOnLevel, sceneRampRate) : formatOnLevel(sceneOnLevel)}
        </span>
      </td>
    </tr>
  );
}

/* ─── Controller Row (read-only) ──────────────────────────── */

function ControllerRow({
  member,
  getProperty,
  sceneOnLevel,
}: {
  member: SceneMember;
  getProperty: GetPropertyFn;
  /** Scene-specific on-level (from SOAP G_SP) — undefined if not yet loaded */
  sceneOnLevel?: number;
}) {
  const typeInfo = getDeviceTypeInfo(member.nodeDefId, member.nodeType);
  const IconComponent = ICON_MAP[typeInfo.icon];
  const stProp = getProperty(member.address, 'ST');
  const status = stProp ? formatPropertyValue(stProp, typeInfo.category) : 'Unknown';
  const onLevel = sceneOnLevel !== undefined ? formatOnLevel(sceneOnLevel) : '—';

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0">
            {IconComponent && (
              <IconComponent size={14} className="text-gray-500 dark:text-gray-400" />
            )}
          </span>
          <span className="truncate font-medium text-gray-900 dark:text-gray-100">
            {member.name}
          </span>
          <span className="flex-shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
            controller
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
        {status}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
        {onLevel}
      </td>
    </tr>
  );
}

/* ─── Helpers ─────────────────────────────────────────────── */

/**
 * Find the closest percentage option for a given raw on-level (0-255).
 * The dropdown has discrete steps (0, 10, 20, ..., 100).
 */
function findClosestPercent(
  onLevel: number,
  options: { percent: number; level255: number }[],
): number {
  let closest = options[0]!;
  let minDiff = Math.abs(onLevel - closest.level255);
  for (const opt of options) {
    const diff = Math.abs(onLevel - opt.level255);
    if (diff < minDiff) {
      closest = opt;
      minDiff = diff;
    }
  }
  return closest.percent;
}
