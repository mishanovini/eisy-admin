/**
 * Batteries page — comprehensive view of all battery-powered devices.
 * Shows battery levels, per-device-type thresholds, and status flags.
 *
 * Multi-node devices (Insteon remotes with buttons A-D, Z-Wave locks with
 * alarm/sensor endpoints) are grouped into a single row per physical device.
 * The battery level is taken from whichever sub-node reports BATLVL.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Battery,
  BatteryWarning,
  BatteryLow,
  ArrowUpDown,
  Filter,
  ChevronLeft,
} from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useStatusStore } from '@/stores/status-store.ts';
import {
  getDeviceTypeInfo,
  getBatteryThreshold,
  getBatteryStatus,
  type DeviceCategory,
} from '@/utils/device-types.ts';
import { getPhysicalDeviceAddress } from '@/utils/address.ts';
import type { IsyNode } from '@/api/types.ts';

interface BatteryRow {
  /** Address of the primary (sub-node 1) device — used for navigation */
  address: string;
  name: string;
  /** Battery level 0-100, or null if device hasn't reported it (sleep-mode devices) */
  level: number | null;
  category: DeviceCategory;
  categoryLabel: string;
  status: 'good' | 'low' | 'critical' | 'unknown';
  warnThreshold: number;
  criticalThreshold: number;
  typicalBattery: string;
}

type SortField = 'name' | 'level' | 'category' | 'status';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'low' | 'critical' | 'unknown';

/**
 * Intermediate structure for grouping sub-nodes of the same physical device.
 * We collect all sub-nodes, then produce one BatteryRow per group.
 */
interface DeviceGroup {
  /** Primary node (sub-node 1, or the node matching pnode) */
  primaryNode: IsyNode;
  /** Best battery level found across all sub-nodes (lowest if multiple report) */
  batteryLevel: number | null;
  /** Whether any sub-node in this group has hasBattery: true */
  hasBattery: boolean;
}

export function BatteriesPage() {
  const nodes = useDeviceStore((s) => s.nodes);
  const nodeMap = useDeviceStore((s) => s.nodeMap);
  const properties = useStatusStore((s) => s.properties);
  const navigate = useNavigate();

  const [sortField, setSortField] = useState<SortField>('level');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Build battery device rows, grouped by physical device.
  //
  // Multi-node devices (Insteon remotes with buttons A-D, Z-Wave locks with
  // alarm/sensor/repeater endpoints) are collapsed into a single row.
  // The grouping key is either node.pnode (ISY's native parent-node field)
  // or address-based grouping via getPhysicalDeviceAddress().
  const rows = useMemo((): BatteryRow[] => {
    const groups = new Map<string, DeviceGroup>();

    for (const node of nodes) {
      const addr = String(node.address);
      const nodeProps = properties.get(addr);
      const bat = nodeProps?.get('BATLVL');
      const typeInfo = getDeviceTypeInfo(node['@_nodeDefId'], node.type ? String(node.type) : undefined);
      const batLevel = bat ? Number(bat['@_value']) : null;

      // Determine the group key: the physical device this node belongs to.
      // Use pnode if available (ISY's native field), otherwise derive from address.
      const pnodeAddr = node.pnode ? String(node.pnode) : null;
      const groupKey = pnodeAddr ?? getPhysicalDeviceAddress(addr);

      const existing = groups.get(groupKey);
      if (existing) {
        // Merge into existing group
        if (batLevel !== null) {
          // Use the lowest battery level if multiple sub-nodes report
          existing.batteryLevel = existing.batteryLevel !== null
            ? Math.min(existing.batteryLevel, batLevel)
            : batLevel;
        }
        if (typeInfo.hasBattery) {
          existing.hasBattery = true;
        }
      } else {
        // New group — determine the primary node
        // If pnode points to a different node, use that as primary
        let primaryNode = node;
        if (pnodeAddr && pnodeAddr !== addr) {
          const pnodeNode = nodeMap.get(pnodeAddr);
          if (pnodeNode) primaryNode = pnodeNode;
        }

        groups.set(groupKey, {
          primaryNode,
          batteryLevel: batLevel,
          hasBattery: typeInfo.hasBattery || (batLevel !== null),
        });
      }
    }

    // Convert groups to BatteryRow[], filtering to only battery devices
    const result: BatteryRow[] = [];
    for (const [groupAddr, group] of groups) {
      if (!group.hasBattery && group.batteryLevel === null) continue;

      const typeInfo = getDeviceTypeInfo(group.primaryNode['@_nodeDefId'], group.primaryNode.type ? String(group.primaryNode.type) : undefined);
      // If primary node's type doesn't have battery but we detected one,
      // use the group's battery info with the primary node's category
      const category = typeInfo.category;
      const threshold = getBatteryThreshold(category);

      result.push({
        address: groupAddr,
        name: group.primaryNode.name,
        level: group.batteryLevel,
        category,
        categoryLabel: typeInfo.label,
        status: group.batteryLevel !== null
          ? getBatteryStatus(group.batteryLevel, category)
          : 'unknown',
        warnThreshold: threshold.warn,
        criticalThreshold: threshold.critical,
        typicalBattery: threshold.typicalBattery,
      });
    }
    return result;
  }, [nodes, nodeMap, properties]);

  // Filter
  const filtered = useMemo(() => {
    if (statusFilter === 'all') return rows;
    if (statusFilter === 'low') return rows.filter((r) => r.status === 'low' || r.status === 'critical');
    if (statusFilter === 'unknown') return rows.filter((r) => r.status === 'unknown');
    return rows.filter((r) => r.status === 'critical');
  }, [rows, statusFilter]);

  // Sort — null levels (unknown) sort after everything else
  const sorted = useMemo(() => {
    const statusOrder = { critical: 0, low: 1, good: 2, unknown: 3 };
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'level':
          cmp = (a.level ?? 999) - (b.level ?? 999);
          break;
        case 'category':
          cmp = a.categoryLabel.localeCompare(b.categoryLabel);
          break;
        case 'status':
          cmp = statusOrder[a.status] - statusOrder[b.status];
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  // Summary counts
  const criticalCount = rows.filter((r) => r.status === 'critical').length;
  const lowCount = rows.filter((r) => r.status === 'low').length;
  const goodCount = rows.filter((r) => r.status === 'good').length;
  const unknownCount = rows.filter((r) => r.status === 'unknown').length;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <ArrowUpDown
      size={12}
      className={`ml-1 inline-block ${sortField === field ? 'text-blue-500' : 'text-gray-400'}`}
    />
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ChevronLeft size={16} /> Dashboard
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            <Battery size={22} className="mr-2 inline-block text-amber-500" />
            Battery Status
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {rows.length} battery device{rows.length !== 1 ? 's' : ''}
            {criticalCount > 0 && (
              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                {criticalCount} critical
              </span>
            )}
            {lowCount > 0 && (
              <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {lowCount} low
              </span>
            )}
            {goodCount > 0 && (
              <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                {goodCount} good
              </span>
            )}
            {unknownCount > 0 && (
              <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {unknownCount} not reported
              </span>
            )}
          </p>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            <option value="all">All ({rows.length})</option>
            <option value="low">Low & Critical ({lowCount + criticalCount})</option>
            <option value="critical">Critical Only ({criticalCount})</option>
            {unknownCount > 0 && (
              <option value="unknown">Not Reported ({unknownCount})</option>
            )}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
              <th
                onClick={() => handleSort('name')}
                className="cursor-pointer px-4 py-2.5 text-left font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Device <SortIcon field="name" />
              </th>
              <th
                onClick={() => handleSort('category')}
                className="cursor-pointer px-4 py-2.5 text-left font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Type <SortIcon field="category" />
              </th>
              <th
                onClick={() => handleSort('level')}
                className="cursor-pointer px-4 py-2.5 text-left font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Battery Level <SortIcon field="level" />
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-600 dark:text-gray-400">
                Threshold
              </th>
              <th
                onClick={() => handleSort('status')}
                className="cursor-pointer px-4 py-2.5 text-left font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Status <SortIcon field="status" />
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-600 dark:text-gray-400">
                Typical Battery
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                  {statusFilter !== 'all' ? 'No devices match the current filter.' : 'No battery-powered devices found.'}
                </td>
              </tr>
            )}
            {sorted.map((row) => (
              <tr
                key={row.address}
                onClick={() => navigate(`/devices?select=${encodeURIComponent(String(row.address))}`)}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30"
              >
                {/* Device name */}
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <BatteryIcon level={row.level} status={row.status} />
                    <span className="font-medium text-gray-900 dark:text-gray-100">{row.name}</span>
                  </div>
                </td>

                {/* Category */}
                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                  {row.categoryLabel}
                </td>

                {/* Battery level with bar */}
                <td className="px-4 py-2.5">
                  {row.level !== null ? (
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${levelColor(row.status)}`}>
                        {row.level}%
                      </span>
                      <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className={`h-full rounded-full ${barColor(row.status)}`}
                          style={{ width: `${row.level}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs italic text-gray-400 dark:text-gray-500">
                      Not reported
                    </span>
                  )}
                </td>

                {/* Threshold */}
                <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">
                  <span className="text-xs">
                    Warn: {row.warnThreshold}% &middot; Critical: {row.criticalThreshold}%
                  </span>
                </td>

                {/* Status badge */}
                <td className="px-4 py-2.5">
                  <StatusBadge status={row.status} />
                </td>

                {/* Battery type */}
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                  {row.typicalBattery}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────── */

function BatteryIcon({ level: _level, status }: { level: number | null; status: string }) {
  if (status === 'critical') return <BatteryLow size={18} className="flex-shrink-0 text-red-500" />;
  if (status === 'low') return <BatteryWarning size={18} className="flex-shrink-0 text-amber-500" />;
  if (status === 'unknown') return <Battery size={18} className="flex-shrink-0 text-gray-400" />;
  return <Battery size={18} className="flex-shrink-0 text-green-500" />;
}

function StatusBadge({ status }: { status: 'good' | 'low' | 'critical' | 'unknown' }) {
  if (status === 'critical') {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
        Critical
      </span>
    );
  }
  if (status === 'low') {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        Low
      </span>
    );
  }
  if (status === 'unknown') {
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        Not Reported
      </span>
    );
  }
  return (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
      Good
    </span>
  );
}

function levelColor(status: string): string {
  if (status === 'critical') return 'text-red-600 dark:text-red-400';
  if (status === 'low') return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}

function barColor(status: string): string {
  if (status === 'critical') return 'bg-red-500';
  if (status === 'low') return 'bg-amber-500';
  return 'bg-green-500';
}
