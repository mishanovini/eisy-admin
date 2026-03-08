/**
 * Product Knowledge Base store — IndexedDB-backed store for
 * product entries, system topology, AI context documents,
 * external references, and troubleshooting history.
 *
 * v2 redesign: Product-centric model. Every physical product
 * (Yale YRD256, Aeotec Range Extender 7, Flirc USB, etc.) gets
 * its own entry with specific documentation, references, and
 * troubleshooting. Replaces the generic category-based approach.
 *
 * Uses a dependency-free IndexedDB wrapper (no idb library).
 * Database: "eisy-knowledge" v2 with five object stores.
 */
import { create } from 'zustand';

// ─── Types ────────────────────────────────────────────────────

/** How a product was added to the KB */
export type ProductSource = 'seed' | 'auto-detected' | 'manual' | 'ai-research';

/** Protocol family for a product */
export type ProductProtocol =
  | 'insteon'
  | 'zwave'
  | 'ir'
  | 'wifi'
  | 'cloud'
  | 'usb'
  | 'platform'
  | 'other';

/**
 * Pattern used to auto-detect which ProductEntry a discovered device belongs to.
 * Multiple patterns can match the same product.
 */
export interface ProductMatchPattern {
  type:
    | 'zwave-mfg'            // Exact "mfgId.productType.productId" triplet
    | 'zwave-manufacturer'   // Manufacturer ID only (fallback)
    | 'insteon-nodedefid'    // nodeDefId pattern (e.g., "DimmerLampSwitch_ADV")
    | 'insteon-type'         // ISY type field ("Category.SubCat")
    | 'nodeserver-prefix'    // Node server address prefix (e.g., "n001_irbutton")
    | 'address-prefix';      // Address prefix (e.g., "ZY007")
  pattern: string;
}

/**
 * ProductEntry — a specific product model in the user's system.
 *
 * One entry per physical product MODEL (not per device instance).
 * Example: One entry for "Yale YRD256" covers both the Garage Back Door Lock
 * and the Side Gate Lock. Instance details are in instanceNames.
 */
export interface ProductEntry {
  id: string;
  name: string;                       // "Yale YRD256 Assure Lock SL"
  manufacturer: string;               // "Yale"
  modelNumber: string;                // "YRD256"
  protocol: ProductProtocol;
  description: string;                // Product overview, capabilities, quirks (for AI context)
  /** How this product communicates with the eisy (from original KB spec) */
  signalChain?: string[];             // ["Lock (Z-Wave)", "Z-Wave Mesh", "eisy Hub"]
  /** Patterns for auto-matching discovered devices to this product */
  matchPatterns: ProductMatchPattern[];
  /** true for products not directly connected to eisy (Harmony Remote, Google Home, etc.) */
  isExternal: boolean;
  /** How many instances of this product are installed */
  instanceCount: number;
  /** Names of specific device instances */
  instanceNames?: string[];           // ["Garage Back Door Lock", "Side Gate Lock"]
  /** Searchable tags for grouping and filtering */
  tags: string[];                     // ["lock", "security", "battery-powered", "z-wave"]
  source: ProductSource;
  createdAt: number;
  updatedAt: number;
}

/**
 * SystemTopology — curated singleton describing how the entire system connects.
 * The AI chatbot uses the narrative field for broad system awareness.
 * The UI renders the structured data as a hub-and-spoke diagram.
 */
export interface SystemTopology {
  id: 'system-topology';
  hub: {
    name: string;                     // "eisy"
    firmware: string;                 // "IoX 6.0.0"
    ip: string;                       // "192.168.4.123"
    protocols: string[];              // ["Insteon", "Z-Wave", "IR"]
  };
  /** Protocol groups — clusters of products by protocol */
  protocolGroups: {
    protocol: ProductProtocol;
    label: string;                    // "Insteon Dual-Band Mesh"
    productIds: string[];             // References to ProductEntry.id
    notes?: string;
  }[];
  /** External systems connected to eisy */
  externalSystems: {
    name: string;                     // "Google Home / Voice Control"
    connectionPath: string;           // "Cloud via my.isy.io portal"
    productIds: string[];
    notes?: string;
  }[];
  /** Prose summary for AI context injection — the most valuable field */
  narrative: string;
  updatedAt: number;
}

/** AI context document — curated text for chatbot context, linked to a product */
export interface ContextDocument {
  id: string;
  productId: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

/** External reference — link to manual/wiki with key notes, linked to a product */
export interface ExternalReference {
  id: string;
  productId: string;
  title: string;
  url: string;
  /** Reference type for UI grouping and display */
  refType: 'manual' | 'tech-doc' | 'forum' | 'wiki' | 'video' | 'config' | 'other';
  notes: string;
  createdAt: number;
}

/** Troubleshooting history — past issues and resolutions, linked to a product */
export interface TroubleshootingEntry {
  id: string;
  productId: string;
  issue: string;
  resolution: string;
  resolvedAt: number;
}

// ─── IndexedDB Wrapper (dependency-free) ──────────────────────

const DB_NAME = 'eisy-knowledge';
const DB_VERSION = 2;
const STORE_NAMES = [
  'products',
  'topology',
  'documents',
  'references',
  'troubleshooting',
] as const;

type StoreName = (typeof STORE_NAMES)[number];

let dbInstance: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;

      if (oldVersion < 2) {
        // ── Migration from v1 → v2 ──
        // Delete old stores that are replaced by the product-centric model
        if (db.objectStoreNames.contains('integrations')) {
          db.deleteObjectStore('integrations');
        }
        if (db.objectStoreNames.contains('mappings')) {
          db.deleteObjectStore('mappings');
        }
        // Create new stores
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('topology')) {
          db.createObjectStore('topology', { keyPath: 'id' });
        }
        // documents, references, troubleshooting — keep stores but data
        // will be cleared since old records reference non-existent integrationId.
        // Auto-seed will repopulate with productId references.
        if (!db.objectStoreNames.contains('documents')) {
          db.createObjectStore('documents', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('references')) {
          db.createObjectStore('references', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('troubleshooting')) {
          db.createObjectStore('troubleshooting', { keyPath: 'id' });
        }
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message ?? 'unknown'}`));
    };
  });
}

function dbGetAll<T>(storeName: StoreName): Promise<T[]> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(new Error(`getAll failed on ${storeName}`));
      }),
  );
}

function dbPut<T>(storeName: StoreName, item: T): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(new Error(`put failed on ${storeName}`));
      }),
  );
}

function dbDelete(storeName: StoreName, id: string): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(new Error(`delete failed on ${storeName}`));
      }),
  );
}

function dbClear(storeName: StoreName): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(new Error(`clear failed on ${storeName}`));
      }),
  );
}

// ─── Store ────────────────────────────────────────────────────

interface KnowledgeState {
  products: ProductEntry[];
  topology: SystemTopology | null;
  documents: ContextDocument[];
  references: ExternalReference[];
  troubleshooting: TroubleshootingEntry[];
  loaded: boolean;

  /** Default location (URL or path) for config files. Pre-fills the URL field when adding config references. */
  defaultConfigLocation: string;

  // Load
  loadAll: () => Promise<void>;

  // Product CRUD
  addProduct: (data: Omit<ProductEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateProduct: (id: string, data: Partial<ProductEntry>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;

  // Topology
  updateTopology: (data: SystemTopology) => Promise<void>;

  // Documents
  addDocument: (data: Omit<ContextDocument, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateDocument: (id: string, data: Partial<ContextDocument>) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;

  // References
  addReference: (data: Omit<ExternalReference, 'id' | 'createdAt'>) => Promise<string>;
  deleteReference: (id: string) => Promise<void>;

  // Troubleshooting
  addTroubleshooting: (data: Omit<TroubleshootingEntry, 'id' | 'resolvedAt'>) => Promise<string>;
  updateTroubleshooting: (id: string, data: Partial<TroubleshootingEntry>) => Promise<void>;
  deleteTroubleshooting: (id: string) => Promise<void>;

  // Config location
  setDefaultConfigLocation: (location: string) => void;

  // AI context helper
  getContextForTopic: (topic: string) => string;

  // Export/import
  exportAll: () => string;
  importAll: (json: string) => Promise<void>;
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  products: [],
  topology: null,
  documents: [],
  references: [],
  troubleshooting: [],
  loaded: false,
  defaultConfigLocation: localStorage.getItem('eisy-kb-config-location') ?? '',

  // ── Load ─────────────────────────────────────────────────

  loadAll: async () => {
    const [products, topologyArr, documents, references, troubleshooting] =
      await Promise.all([
        dbGetAll<ProductEntry>('products'),
        dbGetAll<SystemTopology>('topology'),
        dbGetAll<ContextDocument>('documents'),
        dbGetAll<ExternalReference>('references'),
        dbGetAll<TroubleshootingEntry>('troubleshooting'),
      ]);
    const topology = topologyArr.length > 0 ? topologyArr[0]! : null;
    set({ products, topology, documents, references, troubleshooting, loaded: true });
  },

  // ── Products ───────────────────────────────────────────

  addProduct: async (data) => {
    const now = Date.now();
    const item: ProductEntry = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await dbPut('products', item);
    set((s) => ({ products: [...s.products, item] }));
    return item.id;
  },

  updateProduct: async (id, data) => {
    const state = get();
    const existing = state.products.find((p) => p.id === id);
    if (!existing) return;
    const updated: ProductEntry = { ...existing, ...data, id, updatedAt: Date.now() };
    await dbPut('products', updated);
    set((s) => ({
      products: s.products.map((p) => (p.id === id ? updated : p)),
    }));
  },

  deleteProduct: async (id) => {
    await dbDelete('products', id);
    // Also remove child records
    const state = get();
    const childDocs = state.documents.filter((d) => d.productId === id);
    const childRefs = state.references.filter((r) => r.productId === id);
    const childTrouble = state.troubleshooting.filter((t) => t.productId === id);
    await Promise.all([
      ...childDocs.map((d) => dbDelete('documents', d.id)),
      ...childRefs.map((r) => dbDelete('references', r.id)),
      ...childTrouble.map((t) => dbDelete('troubleshooting', t.id)),
    ]);
    set((s) => ({
      products: s.products.filter((p) => p.id !== id),
      documents: s.documents.filter((d) => d.productId !== id),
      references: s.references.filter((r) => r.productId !== id),
      troubleshooting: s.troubleshooting.filter((t) => t.productId !== id),
    }));
  },

  // ── Topology ───────────────────────────────────────────

  updateTopology: async (data) => {
    await dbPut('topology', data);
    set({ topology: data });
  },

  // ── Documents ──────────────────────────────────────────

  addDocument: async (data) => {
    const now = Date.now();
    const item: ContextDocument = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await dbPut('documents', item);
    set((s) => ({ documents: [...s.documents, item] }));
    return item.id;
  },

  updateDocument: async (id, data) => {
    const state = get();
    const existing = state.documents.find((d) => d.id === id);
    if (!existing) return;
    const updated: ContextDocument = { ...existing, ...data, id, updatedAt: Date.now() };
    await dbPut('documents', updated);
    set((s) => ({
      documents: s.documents.map((d) => (d.id === id ? updated : d)),
    }));
  },

  deleteDocument: async (id) => {
    await dbDelete('documents', id);
    set((s) => ({ documents: s.documents.filter((d) => d.id !== id) }));
  },

  // ── References ─────────────────────────────────────────

  addReference: async (data) => {
    const item: ExternalReference = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    await dbPut('references', item);
    set((s) => ({ references: [...s.references, item] }));
    return item.id;
  },

  deleteReference: async (id) => {
    await dbDelete('references', id);
    set((s) => ({ references: s.references.filter((r) => r.id !== id) }));
  },

  // ── Troubleshooting ───────────────────────────────────

  addTroubleshooting: async (data) => {
    const item: TroubleshootingEntry = {
      ...data,
      id: crypto.randomUUID(),
      resolvedAt: Date.now(),
    };
    await dbPut('troubleshooting', item);
    set((s) => ({ troubleshooting: [...s.troubleshooting, item] }));
    return item.id;
  },

  updateTroubleshooting: async (id, data) => {
    const state = get();
    const existing = state.troubleshooting.find((t) => t.id === id);
    if (!existing) return;
    const updated: TroubleshootingEntry = { ...existing, ...data, id };
    await dbPut('troubleshooting', updated);
    set((s) => ({
      troubleshooting: s.troubleshooting.map((t) => (t.id === id ? updated : t)),
    }));
  },

  deleteTroubleshooting: async (id) => {
    await dbDelete('troubleshooting', id);
    set((s) => ({ troubleshooting: s.troubleshooting.filter((t) => t.id !== id) }));
  },

  // ── Config Location ──────────────────────────────────

  setDefaultConfigLocation: (location) => {
    localStorage.setItem('eisy-kb-config-location', location);
    set({ defaultConfigLocation: location });
  },

  // ── AI Context Helper ─────────────────────────────────

  getContextForTopic: (topic) => {
    const MAX_CHARS = 6000;
    const state = get();
    const keywords = topic
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (keywords.length === 0) return '';

    const matches = (text: string): boolean => {
      const lower = text.toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    };

    const parts: string[] = [];

    // Search products
    for (const product of state.products) {
      if (
        matches(product.name) ||
        matches(product.manufacturer) ||
        matches(product.description) ||
        matches(product.modelNumber) ||
        product.tags.some((t) => matches(t)) ||
        (product.instanceNames ?? []).some((n) => matches(n))
      ) {
        let entry = `## Product: ${product.name} (${product.manufacturer} ${product.modelNumber})`;
        entry += `\nProtocol: ${product.protocol}`;
        if (product.instanceCount > 0) entry += ` | ${product.instanceCount} instance(s)`;
        if (product.instanceNames?.length) entry += `\nInstances: ${product.instanceNames.join(', ')}`;
        if (product.signalChain?.length) entry += `\nSignal chain: ${product.signalChain.join(' → ')}`;
        entry += `\n${product.description}`;
        parts.push(entry);
      }
    }

    // Search context documents
    for (const doc of state.documents) {
      if (matches(doc.title) || matches(doc.content)) {
        parts.push(`## ${doc.title}\n${doc.content}`);
      }
    }

    // Include topology narrative for broad system questions
    if (
      state.topology &&
      (matches('topology') || matches('system') || matches('architecture') ||
       matches('overview') || matches('network') || matches('connected'))
    ) {
      parts.push(`## System Topology\n${state.topology.narrative}`);
    }

    // Search troubleshooting entries
    for (const entry of state.troubleshooting) {
      if (matches(entry.issue) || matches(entry.resolution)) {
        parts.push(`## Past Issue\n**Problem:** ${entry.issue}\n**Resolution:** ${entry.resolution}`);
      }
    }

    let result = parts.join('\n\n');
    if (result.length > MAX_CHARS) {
      result = result.slice(0, MAX_CHARS) + '\n\n[...truncated]';
    }
    return result;
  },

  // ── Export / Import ───────────────────────────────────

  exportAll: () => {
    const { products, topology, documents, references, troubleshooting, defaultConfigLocation } = get();
    return JSON.stringify(
      {
        version: 2,
        exportedAt: Date.now(),
        products,
        topology,
        documents,
        references,
        troubleshooting,
        defaultConfigLocation: defaultConfigLocation || undefined,
      },
      null,
      2,
    );
  },

  importAll: async (json) => {
    const data = JSON.parse(json) as {
      version?: number;
      products?: ProductEntry[];
      topology?: SystemTopology;
      documents?: ContextDocument[];
      references?: ExternalReference[];
      troubleshooting?: TroubleshootingEntry[];
      defaultConfigLocation?: string;
    };

    // Clear all stores first
    await Promise.all(STORE_NAMES.map((name) => dbClear(name)));

    const products = data.products ?? [];
    const topology = data.topology ?? null;
    const documents = data.documents ?? [];
    const references = data.references ?? [];
    const troubleshooting = data.troubleshooting ?? [];

    // Write all records
    await Promise.all([
      ...products.map((p) => dbPut('products', p)),
      ...(topology ? [dbPut('topology', topology)] : []),
      ...documents.map((d) => dbPut('documents', d)),
      ...references.map((r) => dbPut('references', r)),
      ...troubleshooting.map((t) => dbPut('troubleshooting', t)),
    ]);

    // Restore config location if present in the import
    if (data.defaultConfigLocation) {
      localStorage.setItem('eisy-kb-config-location', data.defaultConfigLocation);
      set({ products, topology, documents, references, troubleshooting, loaded: true, defaultConfigLocation: data.defaultConfigLocation });
    } else {
      set({ products, topology, documents, references, troubleshooting, loaded: true });
    }
  },
}));
