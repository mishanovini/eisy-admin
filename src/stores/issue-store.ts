/**
 * Issue store — bug reports and feature requests stored in IndexedDB.
 * Follows the same pattern as log-store.ts: IndexedDB-backed Zustand store
 * with in-memory cache for fast UI rendering.
 *
 * Reports can be created from:
 *   1. Troubleshooter Step 4 (after AI diagnosis)
 *   2. AI chatbot (via file_issue_report tool)
 *   3. Manual submission from the Troubleshooter page
 *
 * Each report captures diagnostic data (logs, system info, AI analysis)
 * and can be submitted to GitHub Issues via the github.ts API client.
 */
import { create } from 'zustand';
import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { LogEntry } from './log-store.ts';
import { isWebSocketConnected } from '@/api/websocket.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import { createGitHubIssue, syncGitHubIssueStatuses, hasGitHubToken } from '@/api/github.ts';
import { APP_VERSION } from '@/utils/version.ts';

// ─── Types ────────────────────────────────────────────────────

export type IssueType = 'bug' | 'feature';

export type IssueStatus =
  | 'draft'        // Created locally, not yet submitted
  | 'submitted'    // Sent to GitHub
  | 'acknowledged' // Developer has seen it
  | 'in-progress'  // Developer is working on it
  | 'resolved'     // Fix applied in a release
  | 'closed';      // Closed without fix (won't-fix, duplicate, etc.)

export interface SystemInfo {
  appVersion: string;
  deviceCount: number;
  sceneCount: number;
  programCount: number;
  wsConnected: boolean;
  browserInfo: string;
  timestamp: number;
}

export interface IssueReport {
  id?: number;                   // Auto-increment key
  timestamp: number;             // Creation time
  type: IssueType;
  title: string;
  description: string;           // User's description of the issue
  aiDiagnosis?: string;          // AI's technical analysis
  proposedFix?: string;          // AI's recommended code fix
  category?: string;             // Issue category (from Troubleshooter)
  devices?: string[];            // Affected device addresses
  deviceNames?: string[];        // Resolved device names
  logs?: LogEntry[];             // Snapshot of relevant log entries
  systemInfo?: SystemInfo;       // Auto-captured system state
  status: IssueStatus;
  githubIssueNumber?: number;    // GitHub issue # after submission
  githubIssueUrl?: string;       // GitHub issue URL
  resolution?: string;           // Developer's response text
  resolvedVersion?: string;      // App version containing the fix
  lastSyncedAt?: number;         // Last time status was synced from GitHub
}

// ─── IndexedDB Setup ──────────────────────────────────────────

const DB_NAME = 'eisy-issues';
const DB_VERSION = 1;
const STORE_NAME = 'issues';

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
        store.createIndex('status', 'status');
        store.createIndex('type', 'type');
        store.createIndex('githubIssueNumber', 'githubIssueNumber');
      },
    });
  }
  return dbPromise;
}

// ─── Store ────────────────────────────────────────────────────

interface IssueState {
  /** All issue reports (in-memory cache) */
  reports: IssueReport[];
  loading: boolean;

  /** Create a new issue report (draft) */
  createReport: (partial: Omit<IssueReport, 'id' | 'timestamp' | 'status'>) => Promise<IssueReport>;
  /** Update an existing report */
  updateReport: (id: number, updates: Partial<IssueReport>) => Promise<void>;
  /** Delete a report */
  deleteReport: (id: number) => Promise<void>;
  /** Load all reports from IndexedDB */
  loadReports: () => Promise<void>;
  /** Get a single report by ID */
  getReport: (id: number) => IssueReport | undefined;
  /** Get reports that have been submitted (have GitHub issue numbers) */
  getSubmittedReports: () => IssueReport[];
  /** Submit a draft report to GitHub */
  submitReport: (id: number) => Promise<void>;
  /** Sync statuses of all submitted reports from GitHub */
  syncStatuses: () => Promise<void>;
  /** Capture current system info for a report */
  captureSystemInfo: () => SystemInfo;
}

export const useIssueStore = create<IssueState>((set, get) => ({
  reports: [],
  loading: false,

  createReport: async (partial) => {
    const db = await getDb();
    const report: IssueReport = {
      ...partial,
      timestamp: Date.now(),
      status: 'draft',
    };

    const id = await db.add(STORE_NAME, report) as number;
    const created = { ...report, id };

    // Update in-memory cache
    set((s) => ({ reports: [created, ...s.reports] }));
    return created;
  },

  updateReport: async (id, updates) => {
    const db = await getDb();
    const existing = await db.get(STORE_NAME, id) as IssueReport | undefined;
    if (!existing) return;

    const updated = { ...existing, ...updates };
    await db.put(STORE_NAME, updated);

    // Update in-memory cache
    set((s) => ({
      reports: s.reports.map((r) => (r.id === id ? updated : r)),
    }));
  },

  deleteReport: async (id) => {
    const db = await getDb();
    await db.delete(STORE_NAME, id);

    set((s) => ({
      reports: s.reports.filter((r) => r.id !== id),
    }));
  },

  loadReports: async () => {
    set({ loading: true });
    try {
      const db = await getDb();
      const all = await db.getAll(STORE_NAME) as IssueReport[];
      // Sort by timestamp descending (newest first)
      all.sort((a, b) => b.timestamp - a.timestamp);
      set({ reports: all, loading: false });
    } catch (err) {
      console.error('[Issues] Failed to load reports:', err);
      set({ loading: false });
    }
  },

  getReport: (id) => {
    return get().reports.find((r) => r.id === id);
  },

  getSubmittedReports: () => {
    return get().reports.filter((r) => r.githubIssueNumber != null);
  },

  submitReport: async (id) => {
    const report = get().reports.find((r) => r.id === id);
    if (!report || !report.id) return;
    if (report.status !== 'draft') return; // Already submitted

    if (!hasGitHubToken()) {
      throw new Error('No GitHub token configured. Add one in Settings.');
    }

    try {
      const { number, url } = await createGitHubIssue(report);
      await get().updateReport(report.id, {
        status: 'submitted',
        githubIssueNumber: number,
        githubIssueUrl: url,
      });
      console.log(`[Issues] Submitted report #${report.id} → GitHub #${number}`);
    } catch (err) {
      console.error(`[Issues] Failed to submit report #${report.id}:`, err);
      throw err;
    }
  },

  syncStatuses: async () => {
    const submitted = get().getSubmittedReports();
    if (submitted.length === 0) return;
    if (!hasGitHubToken()) return;

    const issueNumbers = submitted
      .filter((r) => r.githubIssueNumber != null)
      .map((r) => r.githubIssueNumber!);

    try {
      const statuses = await syncGitHubIssueStatuses(issueNumbers);

      for (const report of submitted) {
        if (!report.githubIssueNumber || !report.id) continue;
        const ghStatus = statuses.get(report.githubIssueNumber);
        if (!ghStatus) continue;

        // Only update if status changed
        if (ghStatus.status !== report.status ||
            ghStatus.resolution !== report.resolution ||
            ghStatus.resolvedVersion !== report.resolvedVersion) {
          await get().updateReport(report.id, {
            status: ghStatus.status,
            resolution: ghStatus.resolution,
            resolvedVersion: ghStatus.resolvedVersion,
            lastSyncedAt: Date.now(),
          });
        }
      }
      console.log(`[Issues] Synced ${statuses.size} issue statuses from GitHub`);
    } catch (err) {
      console.error('[Issues] Failed to sync statuses:', err);
    }
  },

  captureSystemInfo: () => {
    // Access store state directly (non-reactive — fine for snapshots)
    const devState = useDeviceStore.getState();
    const progState = useProgramStore.getState();

    return {
      appVersion: APP_VERSION,
      deviceCount: devState.nodeMap?.size ?? 0,
      sceneCount: devState.scenes?.length ?? 0,
      programCount: progState.programs?.length ?? 0,
      wsConnected: isWebSocketConnected(),
      browserInfo: navigator.userAgent,
      timestamp: Date.now(),
    };
  },
}));
