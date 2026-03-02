/**
 * Hierarchical folder/device/scene tree.
 * Reads tree from device-store, renders TreeNode recursively.
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { TreeNode } from './TreeNode.tsx';
import type { TreeItem } from '@/stores/device-store.ts';

interface DeviceTreeProps {
  selectedAddress: string | null;
  onSelect: (address: string, type: 'node' | 'scene' | 'folder') => void;
}

export function DeviceTree({ selectedAddress, onSelect }: DeviceTreeProps) {
  const tree = useDeviceStore((s) => s.tree);
  const loading = useDeviceStore((s) => s.loading);
  const fetchAll = useDeviceStore((s) => s.fetchAll);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const hasAutoExpanded = useRef(false);
  const [filter, setFilter] = useState('');

  // Auto-expand all folders when tree first loads
  useEffect(() => {
    if (tree.length > 0 && !hasAutoExpanded.current) {
      hasAutoExpanded.current = true;
      const expanded = new Set<string>();
      function walk(items: TreeItem[]) {
        for (const item of items) {
          if (item.type === 'folder') expanded.add(item.address);
          walk(item.children);
        }
      }
      walk(tree);
      setExpandedFolders(expanded);
    }
  }, [tree]);

  const toggleFolder = useCallback((address: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
      }
      return next;
    });
  }, []);

  // Filter tree items by name
  const filteredTree = useMemo(() => {
    if (!filter.trim()) return tree;
    const lower = filter.toLowerCase();

    function matches(item: typeof tree[0]): boolean {
      if (item.name.toLowerCase().includes(lower)) return true;
      return item.children.some(matches);
    }

    function filterItems(items: typeof tree): typeof tree {
      return items
        .filter(matches)
        .map((item) => ({
          ...item,
          children: filterItems(item.children),
        }));
    }

    return filterItems(tree);
  }, [tree, filter]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter devices..."
            className="w-full rounded border border-gray-300 bg-transparent py-1 pl-7 pr-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
          />
        </div>
        <button
          onClick={() => fetchAll()}
          disabled={loading}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          title="Refresh device list"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredTree.length === 0 && !loading && (
          <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            {filter ? 'No devices match your filter.' : 'No devices found.'}
          </p>
        )}
        {loading && filteredTree.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            Loading devices...
          </p>
        )}
        {filteredTree.map((item) => (
          <TreeNode
            key={item.address}
            item={item}
            depth={0}
            selectedAddress={selectedAddress}
            onSelect={onSelect}
            expandedFolders={filter ? new Set(getAllAddresses(filteredTree)) : expandedFolders}
            onToggleFolder={toggleFolder}
          />
        ))}
      </div>
    </div>
  );
}

/** Get all addresses in the tree (used to auto-expand everything when filtering) */
function getAllAddresses(items: { address: string; children: typeof items }[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    result.push(item.address);
    result.push(...getAllAddresses(item.children));
  }
  return result;
}
