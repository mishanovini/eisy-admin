/**
 * Log store — event log (commands, comms, errors) stored in IndexedDB.
 *
 * CRITICAL ARCHITECTURE NOTE — Memory Safety:
 * loadEntries() uses cursor-based pagination (NOT getAll()) to avoid loading
 * the entire database into memory. With 100+ devices logging state changes via
 * WebSocket, the DB can accumulate tens of thousands of entries. getAll() on
 * such a DB every 5 seconds causes OOM crashes.
 *
 * The cursor walks the timestamp index in reverse (newest-first), collecting
 * only `limit` matching entries. This is O(limit) memory, not O(total_entries).
 *
 * Additional safeguards:
 * - Concurrency guard prevents overlapping loads from piling up
 * - Auto-trim caps the DB at MAX_ENTRIES to prevent unbounded growth
 * - LogsPage uses sequential setTimeout (not setInterval) so the next poll
 *   only starts after the previous one completes
 */
import { create } from 'zustand';
import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';

export type LogCategory = 'command' | 'comms' | 'program' | 'portal' | 'scene' | 'eisy';
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
/** Hard cap on total DB entries — auto-trim oldest when exceeded */
const MAX_ENTRIES = 10_000;
/** How many entries to delete per trim cycle (batch to avoid blocking) */
const TRIM_BATCH = 2_000;

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

/** Concurrency guard — prevents overlapping loadEntries calls */
let loadInProgress = false;

/** Trim guard — prevents overlapping trim operations */
let trimScheduled = false;

/**
 * Auto-trim: if the DB exceeds MAX_ENTRIES, delete the oldest TRIM_BATCH.
 * Runs as a fire-and-forget background task, never blocks addEntry.
 */
async function trimIfNeeded(): Promise<void> {
  if (trimScheduled) return;
  trimScheduled = true;

  try {
    const db = await getDb();
    const count = await db.count(STORE_NAME);
    if (count <= MAX_ENTRIES) return;

    const toDelete = Math.min(count - MAX_ENTRIES + TRIM_BATCH, count);
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const index = tx.store.index('timestamp');
    let cursor = await index.openCursor(); // oldest first
    let deleted = 0;

    while (cursor && deleted < toDelete) {
      await cursor.delete();
      deleted++;
      cursor = await cursor.continue();
    }
    await tx.done;

    if (deleted > 0) {
      console.log(`[LogStore] Auto-trimmed ${deleted} oldest entries (DB had ${count})`);
    }
  } catch (err) {
    console.warn('[LogStore] Auto-trim failed:', err);
  } finally {
    trimScheduled = false;
  }
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
    /** Categories to exclude from results (e.g., 'eisy' for the All tab) */
    excludeCategory?: LogCategory;
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

    // Auto-trim in background (fire-and-forget)
    trimIfNeeded().catch(() => {});
  },

  loadEntries: async (options) => {
    // Concurrency guard: skip if a load is already in progress.
    // This prevents overlapping reads from piling up and exhausting memory.
    if (loadInProgress) return;
    loadInProgress = true;
    set({ loading: true });

    try {
      const db = await getDb();
      const limit = options?.limit ?? 200;
      const entries: LogEntry[] = [];

      // Walk the timestamp index in reverse (newest first) using a cursor.
      // This is O(limit) memory — we never load the full DB into JS heap.
      const tx = db.transaction(STORE_NAME, 'readonly');
      const index = tx.store.index('timestamp');
      let cursor = await index.openCursor(null, 'prev'); // newest-first

      while (cursor && entries.length < limit) {
        const entry = cursor.value as LogEntry;

        // Category filter
        if (options?.category && entry.category !== options.category) {
          cursor = await cursor.continue();
          continue;
        }

        // Exclude category (e.g., skip 'eisy' on the All tab)
        if (options?.excludeCategory && entry.category === options.excludeCategory) {
          cursor = await cursor.continue();
          continue;
        }

        // Since filter — if we've passed the cutoff, stop entirely
        // (entries are in descending order, so once we're past 'since', all remaining are older)
        if (options?.since && entry.timestamp < options.since) break;

        entries.push(entry);
        cursor = await cursor.continue();
      }

      set({ entries, loading: false });
    } catch (err) {
      console.error('[LogStore] Failed to load entries:', err);
      set({ loading: false });
    } finally {
      loadInProgress = false;
    }
  },

  purgeOld: async () => {
    const db = await getDb();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const index = tx.store.index('timestamp');
    let cursor = await index.openCursor(); // oldest first
    let deleted = 0;

    while (cursor) {
      if ((cursor.value as LogEntry).timestamp < cutoff) {
        await cursor.delete();
        deleted++;
      } else {
        // Entries are sorted ascending — once we pass the cutoff, we're done
        break;
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return deleted;
  },

  exportCsv: async () => {
    // Export uses cursor to stream entries without loading all into memory at once.
    // Builds CSV incrementally to keep heap pressure low.
    const db = await getDb();
    const headers = ['timestamp', 'category', 'device', 'deviceName', 'action', 'source', 'result', 'detail'];
    const csvParts: string[] = [headers.join(',')];

    const tx = db.transaction(STORE_NAME, 'readonly');
    const index = tx.store.index('timestamp');
    let cursor = await index.openCursor(null, 'prev'); // newest first

    while (cursor) {
      const e = cursor.value as LogEntry;
      const row = headers.map((h) => {
        const val = e[h as keyof LogEntry];
        if (h === 'timestamp') return new Date(val as number).toISOString();
        return String(val ?? '').replace(/"/g, '""');
      }).map((v) => `"${v}"`).join(',');
      csvParts.push(row);
      cursor = await cursor.continue();
    }

    return csvParts.join('\n');
  },
}));
