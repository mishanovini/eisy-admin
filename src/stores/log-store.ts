/**
 * Log store — event log (commands, comms, errors) stored in IndexedDB.
 * Three categories: command, comms, program. All filterable and sortable.
 * Every entry is human-readable with device causality tracking.
 */
import { create } from 'zustand';
import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';

export type LogCategory = 'command' | 'comms' | 'program' | 'portal';
export type LogResult = 'success' | 'fail' | 'pending';

export interface LogEntry {
  id?: number; // auto-increment
  timestamp: number;
  category: LogCategory;
  device?: string; // device address
  deviceName?: string;
  action: string; // human-readable action description
  source: string; // what caused it: "manual", "program:XX", "scene:XX", "ai", "self-healing"
  result: LogResult;
  detail?: string; // additional context
  rawCommand?: string; // raw REST/SOAP command for debugging
}

const DB_NAME = 'eisy-logs';
const DB_VERSION = 1;
const STORE_NAME = 'logs';
const RETENTION_DAYS = 30;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('timestamp', 'timestamp');
        store.createIndex('category', 'category');
        store.createIndex('device', 'device');
        store.createIndex('source', 'source');
        store.createIndex('result', 'result');
      },
    });
  }
  return dbPromise;
}

interface LogState {
  /** Recent log entries (in-memory cache for display) */
  entries: LogEntry[];
  loading: boolean;

  /** Add a log entry */
  addEntry: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => Promise<void>;
  /** Load entries from IndexedDB (with optional filters) */
  loadEntries: (options?: {
    category?: LogCategory;
    limit?: number;
    since?: number;
  }) => Promise<void>;
  /** Purge entries older than retention period */
  purgeOld: () => Promise<number>;
  /** Export all entries as CSV */
  exportCsv: () => Promise<string>;
}

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  loading: false,

  addEntry: async (entry) => {
    const full: LogEntry = { ...entry, timestamp: Date.now() };
    const db = await getDb();
    await db.add(STORE_NAME, full);

    // Append to in-memory cache
    set((state) => ({
      entries: [full, ...state.entries].slice(0, 500), // keep last 500 in memory
    }));
  },

  loadEntries: async (options) => {
    set({ loading: true });
    const db = await getDb();
    const limit = options?.limit ?? 200;

    let entries: LogEntry[];
    if (options?.category) {
      entries = await db.getAllFromIndex(STORE_NAME, 'category', options.category);
    } else {
      entries = await db.getAll(STORE_NAME);
    }

    // Sort by timestamp descending, apply limit
    entries.sort((a, b) => b.timestamp - a.timestamp);

    if (options?.since) {
      entries = entries.filter((e) => e.timestamp >= options.since!);
    }

    entries = entries.slice(0, limit);
    set({ entries, loading: false });
  },

  purgeOld: async () => {
    const db = await getDb();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const index = tx.store.index('timestamp');
    let cursor = await index.openCursor();
    let deleted = 0;

    while (cursor) {
      if ((cursor.value as LogEntry).timestamp < cutoff) {
        await cursor.delete();
        deleted++;
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return deleted;
  },

  exportCsv: async () => {
    const db = await getDb();
    const entries: LogEntry[] = await db.getAll(STORE_NAME);
    entries.sort((a, b) => b.timestamp - a.timestamp);

    const headers = ['timestamp', 'category', 'device', 'deviceName', 'action', 'source', 'result', 'detail'];
    const rows = entries.map((e) =>
      headers.map((h) => {
        const val = e[h as keyof LogEntry];
        if (h === 'timestamp') return new Date(val as number).toISOString();
        return String(val ?? '').replace(/"/g, '""');
      }).map((v) => `"${v}"`).join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  },
}));
