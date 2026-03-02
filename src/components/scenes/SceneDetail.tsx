/**
 * Scene detail panel — members, roles, per-device on-level/ramp-rate config.
 *
 * Redesigned to match the UDAC scene editor functionality:
 * - "All On" / "All Off" instead of Activate/Deactivate
 * - Additional scene control buttons (Fast On/Off, Brighten, Dim, etc.)
 * - Per-responder on-level and ramp-rate configuration table
 * - Controllers shown separately (no on-level/ramp-rate config)
 *
 * OL/RR are read from each device's properties in the status store (populated
 * from /rest/status). This is the same data UDAC displays in its scene editor.
 * Changes are applied via REST /rest/nodes/{addr}/set/{prop}/{value}.
 */
import { useState, useCallback } from 'react';
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
} from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useStatusStore } from '@/stores/status-store.ts';
import { sendNodeCommand, setNodeProperty } from '@/api/rest.ts';
import { CMD } from '@/api/types.ts';
import type { IsyProperty } from '@/api/types.ts';
import { getDeviceTypeInfo } from '@/utils/device-types.ts';
import { formatPropertyValue } from '@/utils/labels.ts';
import {
  formatSceneAction,
  getOnLevelOptions,
  getRampRateOptions,
  percentToOnLevel,
  getSceneMembers,
} from '@/utils/scene-utils.ts';
import type { SceneMember } from '@/utils/scene-utils.ts';
import { ICON_MAP } from '@/components/tree/icon-map.ts';

interface SceneDetailProps {
  address: string;
}

export function SceneDetail({ address }: SceneDetailProps) {
  const scene = useDeviceStore((s) => s.getScene(address));
  const nodeMap = useDeviceStore((s) => s.nodeMap);
  const getProperty = useStatusStore((s) => s.getProperty);
  const [pending, setPending] = useState(false);
  const [savingMember, setSavingMember] = useState<string | null>(null);

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
                    getProperty={getProperty}
                    saving={savingMember === member.address}
                    onSaving={setSavingMember}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Controllers */}
      {controllers.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <Users size={14} /> Controllers
          </h3>
          <div className="space-y-1">
            {controllers.map((member) => (
              <ControllerRow key={member.address} member={member} getProperty={getProperty} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {members.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500">No members in this scene.</p>
      )}
    </div>
  );
}

/* ─── Types ───────────────────────────────────────────────── */

type GetPropertyFn = (addr: string, propId: string) => IsyProperty | undefined;

/* ─── Responder Row (with editable on-level/ramp-rate) ────── */

/**
 * Reads the device's OL and RR directly from the status store.
 * These are the same values UDAC shows in the scene responder table.
 * Changes are sent via REST and optimistically written to the status store.
 */
function ResponderRow({
  member,
  getProperty,
  saving,
  onSaving,
}: {
  member: SceneMember;
  getProperty: GetPropertyFn;
  saving: boolean;
  onSaving: (addr: string | null) => void;
}) {
  const typeInfo = getDeviceTypeInfo(member.nodeDefId, member.nodeType);
  const IconComponent = ICON_MAP[typeInfo.icon];
  const stProp = getProperty(member.address, 'ST');
  const status = stProp ? formatPropertyValue(stProp, typeInfo.category) : 'Unknown';

  // Read OL and RR from the device's own properties in the status store
  const olProp = getProperty(member.address, 'OL');
  const rrProp = getProperty(member.address, 'RR');
  const onLevel = olProp ? Number(olProp['@_value']) : 255;
  const rampRate = rrProp ? Number(rrProp['@_value']) : 28;

  const onLevelOptions = getOnLevelOptions();
  const rampRateOptions = getRampRateOptions();

  const handleOnLevelChange = useCallback(async (newPercent: number) => {
    const newLevel = percentToOnLevel(newPercent);
    onSaving(member.address);
    try {
      const ok = await setNodeProperty(member.address, 'OL', newLevel);
      if (ok) {
        // Optimistically update the status store
        const pct = Math.round((newLevel / 255) * 100);
        useStatusStore.getState().updateProperty(member.address, {
          '@_id': 'OL',
          '@_value': newLevel,
          '@_formatted': `${pct}%`,
          '@_uom': '100',
        });
      }
    } finally {
      onSaving(null);
    }
  }, [member.address, onSaving]);

  const handleRampRateChange = useCallback(async (newIndex: number) => {
    onSaving(member.address);
    try {
      const ok = await setNodeProperty(member.address, 'RR', newIndex);
      if (ok) {
        // Find the label for this ramp rate index to use as formatted value
        const opt = rampRateOptions.find((o) => o.index === newIndex);
        useStatusStore.getState().updateProperty(member.address, {
          '@_id': 'RR',
          '@_value': newIndex,
          '@_formatted': opt?.label ?? String(newIndex),
          '@_uom': '25',
        });
      }
    } finally {
      onSaving(null);
    }
  }, [member.address, onSaving, rampRateOptions]);

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
      {/* Device name */}
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
        </div>
      </td>

      {/* Current status */}
      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
        {status}
      </td>

      {/* On Level */}
      <td className="px-3 py-2">
        <select
          value={findClosestPercent(onLevel, onLevelOptions)}
          onChange={(e) => handleOnLevelChange(parseInt(e.target.value, 10))}
          disabled={saving}
          className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          {onLevelOptions.map((opt) => (
            <option key={opt.percent} value={opt.percent}>
              {opt.label}
            </option>
          ))}
        </select>
      </td>

      {/* Ramp Rate */}
      <td className="px-3 py-2">
        <select
          value={rampRate}
          onChange={(e) => handleRampRateChange(parseInt(e.target.value, 10))}
          disabled={saving}
          className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          {rampRateOptions.map((opt) => (
            <option key={opt.index} value={opt.index}>
              {opt.label}
            </option>
          ))}
        </select>
      </td>

      {/* Action summary */}
      <td className="px-3 py-2">
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {saving && <Loader2 size={10} className="mr-1 inline animate-spin" />}
          {formatSceneAction(onLevel, rampRate)}
        </span>
      </td>
    </tr>
  );
}

/* ─── Controller Row (read-only) ──────────────────────────── */

function ControllerRow({
  member,
  getProperty,
}: {
  member: SceneMember;
  getProperty: GetPropertyFn;
}) {
  const typeInfo = getDeviceTypeInfo(member.nodeDefId, member.nodeType);
  const IconComponent = ICON_MAP[typeInfo.icon];
  const stProp = getProperty(member.address, 'ST');
  const status = stProp ? formatPropertyValue(stProp, typeInfo.category) : 'Unknown';

  return (
    <div className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <span className="flex-shrink-0">
        {IconComponent && (
          <IconComponent size={16} className="text-gray-500 dark:text-gray-400" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">
        {member.name}
      </span>
      <span className="flex-shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        controller
      </span>
      <span className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
        {status}
      </span>
    </div>
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
