/**
 * Network Health page — table view of all devices with communication status,
 * protocol info, battery levels, and query actions.
 *
 * Multi-node devices (Insteon outlets with 2 nodes, Z-Wave locks with
 * alarm/sensor endpoints) are collapsed into a single row per physical device.
 */
import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  ArrowUpDown,
} from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useStatusStore } from '@/stores/status-store.ts';
import { getDeviceTypeInfo } from '@/utils/device-types.ts';
import { getProtocolFamily, formatAddress, getPhysicalDeviceAddress } from '@/utils/address.ts';
import { queryNode } from '@/api/rest.ts';
import type { IsyNode } from '@/api/types.ts';

/** One row in the network health table (one per physical device) */
interface DeviceHealth {
  /** Primary node address (used for navigation and querying) */
  address: string;
  name: string;
  category: string;
  protocol: string;
  battery: number | null;
  hasStatus: boolean;
  /** Number of sub-nodes collapsed into this row */
  nodeCount: number;
}

type SortKey = 'name' | 'protocol' | 'category' | 'battery' | 'status';
type SortDir = 'asc' | 'desc';

export function NetworkPage() {
  const nodes = useDeviceStore((s) => s.nodes);
  const nodeMap = useDeviceStore((s) => s.nodeMap);
  const properties = useStatusStore((s) => s.properties);
  const fetchAll = useDeviceStore((s) => s.fetchAll);
  const fetchStatus = useStatusStore((s) => s.fetchAll);
  const loading = useDeviceStore((s) => s.loading);
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [querying, setQuerying] = useState<string | null>(null);

  // Build one row per physical device, collapsing multi-node devices.
  // Uses pnode (ISY's native parent-node field) or address-based grouping.
  const devices = useMemo<DeviceHealth[]>(() => {
    // Group nodes by physical device
    const groups = new Map<string, { primaryNode: IsyNode; battery: number | null; hasStatus: boolean; count: number }>();

    for (const node of nodes) {
      const addr = String(node.address);
      const nodeProps = properties.get(addr);
      const bat = nodeProps?.get('BATLVL');
      const batLevel = bat ? Number(bat['@_value']) : null;
      const hasNodeStatus = !!nodeProps && nodeProps.size > 0;

      // Determine the group key (physical device)
      const pnodeAddr = node.pnode ? String(node.pnode) : null;
      const groupKey = pnodeAddr ?? getPhysicalDeviceAddress(addr);

      const existing = groups.get(groupKey);
      if (existing) {
        existing.count++;
        // Use lowest battery if multiple report
        if (batLevel !== null) {
          existing.battery = existing.battery !== null
            ? Math.min(existing.battery, batLevel)
            : batLevel;
        }
        // Device has status if ANY sub-node has status
        if (hasNodeStatus) existing.hasStatus = true;
      } else {
        // New group — determine primary node
        let primaryNode = node;
        if (pnodeAddr && pnodeAddr !== addr) {
          const pnodeNode = nodeMap.get(pnodeAddr);
          if (pnodeNode) primaryNode = pnodeNode;
        }

        groups.set(groupKey, {
          primaryNode,
          battery: batLevel,
          hasStatus: hasNodeStatus,
          count: 1,
        });
      }
    }

    // Convert groups to DeviceHealth rows
    const result: DeviceHealth[] = [];
    for (const [groupAddr, group] of groups) {
      const typeInfo = getDeviceTypeInfo(group.primaryNode['@_nodeDefId'], group.primaryNode.type ? String(group.primaryNode.type) : undefined);
      const protocol = getProtocolFamily(String(group.primaryNode.address));

      result.push({
        address: groupAddr,
        name: group.primaryNode.name,
        category: typeInfo.label,
        protocol: protocol === 'insteon' ? 'Insteon' : protocol === 'zwave' ? 'Z-Wave' : 'Other',
        battery: group.battery,
        hasStatus: group.hasStatus,
        nodeCount: group.count,
      });
    }

    return result;
  }, [nodes, nodeMap, properties]);

  const filtered = useMemo(() => {
    let result = devices;
    if (filter.trim()) {
      const lower = filter.toLowerCase();
      result = result.filter(
        (d) => d.name.toLowerCase().includes(lower) || d.protocol.toLowerCase().includes(lower) || d.category.toLowerCase().includes(lower),
      );
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'protocol': cmp = a.protocol.localeCompare(b.protocol); break;
        case 'category': cmp = a.category.localeCompare(b.category); break;
        case 'battery': cmp = (a.battery ?? 999) - (b.battery ?? 999); break;
        case 'status': cmp = (a.hasStatus ? 1 : 0) - (b.hasStatus ? 1 : 0); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [devices, filter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleQuery = async (address: string) => {
    setQuerying(address);
    await queryNode(address);
    setTimeout(() => {
      fetchStatus();
      setQuerying(null);
    }, 2000);
  };

  // Protocol counts based on grouped devices (not raw nodes)
  const protocolCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of devices) {
      counts[d.protocol] = (counts[d.protocol] ?? 0) + 1;
    }
    return counts;
  }, [devices]);

  const noStatusCount = devices.filter((d) => !d.hasStatus).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Network Health</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {devices.length} devices &middot;{' '}
            {Object.entries(protocolCounts).map(([k, v]) => `${v} ${k}`).join(', ')}
          </p>
        </div>
        <button
          onClick={() => { fetchAll(); fetchStatus(); }}
          disabled={loading}
          className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(protocolCounts).map(([proto, count]) => (
          <div key={proto} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{count}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{proto} devices</p>
          </div>
        ))}
        {noStatusCount > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/10">
            <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{noStatusCount}</p>
            <p className="text-xs text-amber-600 dark:text-amber-500">No status reported</p>
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter devices..."
            className="w-full rounded border border-gray-300 bg-transparent py-1.5 pl-8 pr-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
          />
        </div>
        <span className="text-xs text-gray-400">{filtered.length} devices</span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
              <SortHeader label="Device" sortKey="name" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Protocol" sortKey="protocol" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Type" sortKey="category" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Battery" sortKey="battery" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Status" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                  {filter ? 'No devices match your filter.' : 'No devices found.'}
                </td>
              </tr>
            )}
            {filtered.map((d) => (
              <tr
                key={d.address}
                className="hover:bg-gray-50 dark:hover:bg-gray-800/30"
              >
                <td className="px-3 py-2">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{d.name}</p>
                    <p className="font-mono text-xs text-gray-400">
                      {formatAddress(d.address)}
                    </p>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    d.protocol === 'Insteon' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : d.protocol === 'Z-Wave' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    {d.protocol}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                  {d.category}
                </td>
                <td className="px-3 py-2">
                  {d.battery !== null ? (
                    <span className={`text-sm font-medium ${
                      d.battery <= 10 ? 'text-red-600 dark:text-red-400'
                      : d.battery <= 25 ? 'text-amber-600 dark:text-amber-400'
                      : 'text-green-600 dark:text-green-400'
                    }`}>
                      {d.battery}%
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">&mdash;</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {d.hasStatus ? (
                    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle2 size={14} /> OK
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle size={14} /> No data
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => handleQuery(d.address)}
                    disabled={querying === d.address}
                    className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    {querying === d.address ? <RefreshCw size={12} className="animate-spin" /> : 'Query'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({ label, sortKey, currentKey, dir, onSort }: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = sortKey === currentKey;
  return (
    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
      <button onClick={() => onSort(sortKey)} className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
        {label}
        <ArrowUpDown size={12} className={isActive ? 'text-blue-500' : 'opacity-30'} />
        {isActive && <span className="text-blue-500">{dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}
