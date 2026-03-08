/**
 * Individual tree item — folder, device, or scene.
 * Shows icon, name, inline status, expand/collapse for folders.
 *
 * Supports drag & drop:
 * - Device nodes and scenes are draggable
 * - Scene nodes accept device drops (add to scene)
 * - Folder nodes accept device/scene drops (move to folder)
 */
import { useState, type DragEvent } from 'react';
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

/** Data attached to a drag event when dragging a tree item */
export interface DragNodeData {
  address: string;
  name: string;
  type: 'node' | 'scene';
}

/** ISY node type constants for SetParent SOAP call */
export const ISY_NODE_TYPE = {
  NODE: 1,
  FOLDER: 2,
  GROUP: 3, // scenes
} as const;

interface TreeNodeProps {
  item: TreeItem;
  depth: number;
  selectedAddress: string | null;
  onSelect: (address: string, type: 'node' | 'scene' | 'folder') => void;
  expandedFolders: Set<string>;
  onToggleFolder: (address: string) => void;
  /** Called when a device node is dropped onto a scene node */
  onDropOnScene?: (nodeAddress: string, nodeName: string, sceneAddress: string, sceneName: string) => void;
  /** Called when a device/scene is dropped onto a folder (to move it) */
  onMoveToFolder?: (itemAddress: string, itemName: string, itemType: 'node' | 'scene', folderAddress: string) => void;
}

export function TreeNode({
  item,
  depth,
  selectedAddress,
  onSelect,
  expandedFolders,
  onToggleFolder,
  onDropOnScene,
  onMoveToFolder,
}: TreeNodeProps) {
  const isExpanded = expandedFolders.has(item.address);
  const isSelected = selectedAddress === item.address;
  const hasChildren = item.children.length > 0;
  const [dropTarget, setDropTarget] = useState<'none' | 'scene' | 'folder'>('none');

  // ─── Drag handlers (device nodes and scenes are draggable) ──
  const isDraggable = item.type === 'node' || item.type === 'scene';

  const handleDragStart = (e: DragEvent<HTMLButtonElement>) => {
    if (!isDraggable) return;
    const data: DragNodeData = {
      address: item.address,
      name: item.name,
      type: item.type as 'node' | 'scene',
    };
    e.dataTransfer.setData('application/x-isy-node', JSON.stringify(data));
    // 'copyMove' allows both: copy-to-scene (add member) + move-to-folder (reparent).
    // Using just 'move' would block scene drops because scene targets use 'copy' dropEffect.
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  // ─── Drop handlers ─────────────────────────────────────────
  // Scenes accept device drops (add to scene)
  // Folders accept device/scene drops (move to folder)
  const canAcceptDrop = item.type === 'scene' || item.type === 'folder';

  const handleDragOver = (e: DragEvent<HTMLButtonElement>) => {
    if (!canAcceptDrop) return;
    if (!e.dataTransfer.types.includes('application/x-isy-node')) return;
    e.preventDefault();

    if (item.type === 'scene') {
      e.dataTransfer.dropEffect = 'copy';
      setDropTarget('scene');
    } else {
      e.dataTransfer.dropEffect = 'move';
      setDropTarget('folder');
    }
  };

  const handleDragLeave = () => {
    setDropTarget('none');
  };

  const handleDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const target = dropTarget;
    setDropTarget('none');

    const raw = e.dataTransfer.getData('application/x-isy-node');
    if (!raw) return;

    try {
      const data: DragNodeData = JSON.parse(raw);

      // Don't drop on self
      if (data.address === item.address) return;

      if (target === 'scene' && onDropOnScene && data.type === 'node') {
        // Dropping a device onto a scene → add to scene
        onDropOnScene(data.address, data.name, item.address, item.name);
      } else if (target === 'folder' && onMoveToFolder) {
        // Dropping a device/scene onto a folder → move to folder
        onMoveToFolder(data.address, data.name, data.type, item.address);
      }
    } catch {
      // Invalid drag data — ignore
    }
  };

  // Determine button styling
  let buttonClass = 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800';
  if (isSelected) {
    buttonClass = 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
  }
  if (dropTarget === 'scene') {
    buttonClass = 'bg-purple-100 ring-2 ring-purple-400 ring-inset text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 dark:ring-purple-500';
  }
  if (dropTarget === 'folder') {
    buttonClass = 'bg-amber-100 ring-2 ring-amber-400 ring-inset text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-500';
  }

  return (
    <div>
      <button
        onClick={() => {
          if (item.type === 'folder' && hasChildren) {
            onToggleFolder(item.address);
          }
          onSelect(item.address, item.type);
        }}
        draggable={isDraggable}
        onDragStart={isDraggable ? handleDragStart : undefined}
        onDragOver={canAcceptDrop ? handleDragOver : undefined}
        onDragLeave={canAcceptDrop ? handleDragLeave : undefined}
        onDrop={canAcceptDrop ? handleDrop : undefined}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors ${buttonClass}`}
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
              onDropOnScene={onDropOnScene}
              onMoveToFolder={onMoveToFolder}
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
