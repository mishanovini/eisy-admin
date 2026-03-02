/**
 * Device store — nodes, scenes, and folders tree.
 * Populated from /rest/nodes and /rest/nodes/scenes.
 */
import { create } from 'zustand';
import type { IsyNode, IsyFolder, IsyGroup, NodesResponse } from '@/api/types.ts';
import { fetchNodes, fetchScenes } from '@/api/rest.ts';

/** Unified tree item for display */
export interface TreeItem {
  type: 'folder' | 'node' | 'scene';
  address: string;
  name: string;
  parentAddress: string | null;
  data: IsyNode | IsyFolder | IsyGroup;
  children: TreeItem[];
}

interface DeviceState {
  nodes: IsyNode[];
  folders: IsyFolder[];
  scenes: IsyGroup[];
  nodeMap: Map<string, IsyNode>;
  folderMap: Map<string, IsyFolder>;
  sceneMap: Map<string, IsyGroup>;
  tree: TreeItem[];
  loading: boolean;
  lastFetched: number | null;

  /** Fetch all nodes from the eisy and rebuild tree */
  fetchAll: () => Promise<void>;
  /** Get a node by address */
  getNode: (address: string) => IsyNode | undefined;
  /** Get a scene by address */
  getScene: (address: string) => IsyGroup | undefined;
}

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function getParentAddress(item: { parent?: { '#text': string } }): string | null {
  const p = item.parent?.['#text'];
  return p != null ? String(p) : null;
}

/** Build hierarchical tree from flat node/folder/scene lists */
function buildTree(nodes: IsyNode[], folders: IsyFolder[], scenes: IsyGroup[]): TreeItem[] {
  const items: TreeItem[] = [];

  // IMPORTANT: Always String() addresses — fast-xml-parser coerces numeric-looking
  // values (e.g. scene address "30235") to JS numbers, breaking Map lookups and ===.
  for (const f of folders) {
    items.push({
      type: 'folder',
      address: String(f.address),
      name: f.name,
      parentAddress: null, // folders don't have parent in XML; root-level
      data: f,
      children: [],
    });
  }

  for (const n of nodes) {
    items.push({
      type: 'node',
      address: String(n.address),
      name: n.name,
      parentAddress: getParentAddress(n),
      data: n,
      children: [],
    });
  }

  for (const s of scenes) {
    items.push({
      type: 'scene',
      address: String(s.address),
      name: s.name,
      parentAddress: getParentAddress(s),
      data: s,
      children: [],
    });
  }

  // Build parent→children mapping
  const byAddress = new Map<string, TreeItem>();
  for (const item of items) byAddress.set(item.address, item);

  const roots: TreeItem[] = [];
  for (const item of items) {
    if (item.parentAddress && byAddress.has(item.parentAddress)) {
      byAddress.get(item.parentAddress)!.children.push(item);
    } else {
      roots.push(item);
    }
  }

  // Sort: folders first, then alphabetical
  const sortItems = (arr: TreeItem[]) => {
    arr.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });
    for (const item of arr) sortItems(item.children);
  };
  sortItems(roots);

  return roots;
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  nodes: [],
  folders: [],
  scenes: [],
  nodeMap: new Map(),
  folderMap: new Map(),
  sceneMap: new Map(),
  tree: [],
  loading: false,
  lastFetched: null,

  fetchAll: async () => {
    set({ loading: true });

    const [nodesResp, scenesData] = await Promise.all([
      fetchNodes(),
      fetchScenes(),
    ]);

    const nodes = ensureArray((nodesResp as NodesResponse | null)?.nodes?.node);
    const folders = ensureArray((nodesResp as NodesResponse | null)?.nodes?.folder);
    const scenes = scenesData.length > 0 ? scenesData : ensureArray((nodesResp as NodesResponse | null)?.nodes?.group);

    // IMPORTANT: fast-xml-parser with parseAttributeValue:true coerces
    // numeric-looking addresses (e.g. "30235") to JS numbers. Always
    // String() the key so Map lookups with string keys succeed.
    const nodeMap = new Map<string, IsyNode>();
    for (const n of nodes) nodeMap.set(String(n.address), n);

    const folderMap = new Map<string, IsyFolder>();
    for (const f of folders) folderMap.set(String(f.address), f);

    const sceneMap = new Map<string, IsyGroup>();
    for (const s of scenes) sceneMap.set(String(s.address), s);

    const tree = buildTree(nodes, folders, scenes);

    set({
      nodes,
      folders,
      scenes,
      nodeMap,
      folderMap,
      sceneMap,
      tree,
      loading: false,
      lastFetched: Date.now(),
    });
  },

  // IMPORTANT: Always String() the address — fast-xml-parser coerces numeric
  // addresses (e.g. scene "30235") to JS numbers, but Maps use string keys.
  getNode: (address) => get().nodeMap.get(String(address)),
  getScene: (address) => get().sceneMap.get(String(address)),
}));
