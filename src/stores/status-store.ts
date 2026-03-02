/**
 * Status store — real-time property values for all nodes.
 * Populated initially from /rest/status, then updated via WebSocket events.
 */
import { create } from 'zustand';
import type { IsyProperty } from '@/api/types.ts';
import { fetchAllStatus } from '@/api/rest.ts';

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

/** Property map for a single node: propertyId → IsyProperty */
export type NodeProperties = Map<string, IsyProperty>;

/**
 * Stable empty Map used as fallback for nodes with no properties.
 * CRITICAL: Zustand selectors must return referentially-stable values.
 * Returning `new Map()` each call causes useSyncExternalStore infinite loops.
 */
const EMPTY_NODE_PROPS: NodeProperties = new Map();

interface StatusState {
  /** address → (propertyId → IsyProperty) */
  properties: Map<string, NodeProperties>;
  loading: boolean;
  lastFetched: number | null;

  /** Fetch all status from REST */
  fetchAll: () => Promise<void>;
  /** Update a single property (from WebSocket event) */
  updateProperty: (address: string, prop: IsyProperty) => void;
  /** Get all properties for a node */
  getNodeProperties: (address: string) => NodeProperties;
  /** Get a specific property value for a node */
  getProperty: (address: string, propId: string) => IsyProperty | undefined;
}

export const useStatusStore = create<StatusState>((set, get) => ({
  properties: new Map(),
  loading: false,
  lastFetched: null,

  fetchAll: async () => {
    set({ loading: true });
    const statusNodes = await fetchAllStatus();

    const properties = new Map<string, NodeProperties>();
    for (const sn of statusNodes) {
      const props = ensureArray(sn.property);
      const nodeProps: NodeProperties = new Map();
      for (const p of props) {
        nodeProps.set(p['@_id'], p);
      }
      // IMPORTANT: Always String() — fast-xml-parser coerces numeric addresses
      properties.set(String(sn['@_id']), nodeProps);
    }

    set({ properties, loading: false, lastFetched: Date.now() });
  },

  // IMPORTANT: Always String() addresses — fast-xml-parser coerces
  // numeric-looking values to JS numbers, but Map keys are strings.
  updateProperty: (address, prop) => {
    const current = get().properties;
    const addr = String(address);

    // Skip no-op updates — WebSocket often re-sends the same value.
    // Creating new Map objects on every event causes useSyncExternalStore
    // to detect snapshot mismatches between render and commit, leading to
    // "Maximum update depth exceeded" infinite loops when events are rapid.
    const existing = current.get(addr)?.get(prop['@_id']);
    if (existing
      && existing['@_value'] === prop['@_value']
      && existing['@_formatted'] === prop['@_formatted']
      && existing['@_uom'] === prop['@_uom']) {
      return;
    }

    const nodeProps = new Map(current.get(addr) ?? new Map());
    nodeProps.set(prop['@_id'], prop);
    const updated = new Map(current);
    updated.set(addr, nodeProps);
    set({ properties: updated });
  },

  getNodeProperties: (address) => {
    return get().properties.get(String(address)) ?? EMPTY_NODE_PROPS;
  },

  getProperty: (address, propId) => {
    return get().properties.get(String(address))?.get(propId);
  },
}));
