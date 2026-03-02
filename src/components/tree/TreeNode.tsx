/**
 * Individual tree item — folder, device, or scene.
 * Shows icon, name, inline status, expand/collapse for folders.
 */
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Layers,
} from 'lucide-react';
import type { TreeItem } from '@/stores/device-store.ts';
import { useStatusStore } from '@/stores/status-store.ts';
import { getDeviceTypeInfo } from '@/utils/device-types.ts';
import { formatPropertyValue } from '@/utils/labels.ts';
import { ICON_MAP } from './icon-map.ts';

interface TreeNodeProps {
  item: TreeItem;
  depth: number;
  selectedAddress: string | null;
  onSelect: (address: string, type: 'node' | 'scene' | 'folder') => void;
  expandedFolders: Set<string>;
  onToggleFolder: (address: string) => void;
}

export function TreeNode({
  item,
  depth,
  selectedAddress,
  onSelect,
  expandedFolders,
  onToggleFolder,
}: TreeNodeProps) {
  const isExpanded = expandedFolders.has(item.address);
  const isSelected = selectedAddress === item.address;
  const hasChildren = item.children.length > 0;

  return (
    <div>
      <button
        onClick={() => {
          if (item.type === 'folder' && hasChildren) {
            onToggleFolder(item.address);
          }
          onSelect(item.address, item.type);
        }}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors ${
          isSelected
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        title={item.name}
      >
        {/* Expand/collapse arrow for items with children */}
        <span className="flex w-4 flex-shrink-0 items-center justify-center">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown size={14} className="text-gray-400" />
            ) : (
              <ChevronRight size={14} className="text-gray-400" />
            )
          ) : null}
        </span>

        {/* Icon */}
        <span className="flex-shrink-0">
          <TreeItemIcon item={item} />
        </span>

        {/* Name */}
        <span className="min-w-0 flex-1 truncate">{item.name}</span>

        {/* Inline status for devices */}
        {item.type === 'node' && <InlineStatus address={item.address} item={item} />}
      </button>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div>
          {item.children.map((child) => (
            <TreeNode
              key={child.address}
              item={child}
              depth={depth + 1}
              selectedAddress={selectedAddress}
              onSelect={onSelect}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Render the appropriate icon for the tree item */
function TreeItemIcon({ item }: { item: TreeItem }) {
  if (item.type === 'folder') {
    const isOpen = item.children.length > 0;
    return isOpen ? (
      <FolderOpen size={16} className="text-amber-500" />
    ) : (
      <Folder size={16} className="text-amber-500" />
    );
  }

  if (item.type === 'scene') {
    return <Layers size={16} className="text-purple-500" />;
  }

  // Device node — use device type icon
  const node = item.data as { '@_nodeDefId'?: string; type?: string };
  const typeInfo = getDeviceTypeInfo(node['@_nodeDefId'], node.type ? String(node.type) : undefined);
  const IconComponent = ICON_MAP[typeInfo.icon];
  if (IconComponent) {
    return <IconComponent size={16} className="text-gray-500 dark:text-gray-400" />;
  }
  return <span className="inline-block h-4 w-4" />;
}

/** Show inline status value for a device (e.g., "On", "100%", "Locked") */
function InlineStatus({ address, item }: { address: string; item: TreeItem }) {
  // Select raw Map entry directly — avoid store methods in selectors (infinite loop risk)
  const stProp = useStatusStore((s) => s.properties.get(String(address))?.get('ST'));
  if (!stProp) return null;

  const node = item.data as { '@_nodeDefId'?: string; type?: string };
  const typeInfo = getDeviceTypeInfo(node['@_nodeDefId'], node.type ? String(node.type) : undefined);
  const value = formatPropertyValue(stProp, typeInfo.category);

  // Color-code the status
  const rawVal = Number(stProp['@_value']);
  const isOn = rawVal > 0;

  return (
    <span
      className={`flex-shrink-0 text-xs font-medium ${
        isOn
          ? 'text-green-600 dark:text-green-400'
          : 'text-gray-400 dark:text-gray-500'
      }`}
    >
      {value}
    </span>
  );
}
