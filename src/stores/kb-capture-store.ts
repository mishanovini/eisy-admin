/**
 * KB Capture store — settings, notification state, and tracking for the
 * automatic Knowledge Base capture and error troubleshooting system.
 *
 * Two notification tiers:
 *  - Toast notifications: ephemeral, auto-dismiss after 5s (bottom-right)
 *  - Dashboard notifications: persistent until dismissed (top of Dashboard)
 *
 * Notification history is persisted to the log store for the Logs page.
 * Settings are persisted to localStorage.
 */
import { create } from 'zustand';

// ─── Types ────────────────────────────────────────────────────

export interface KBCaptureSettings {
  /** Master enable/disable for the entire capture system */
  enabled: boolean;
  /** Auto-capture when new devices are detected */
  captureNewDevices: boolean;
  /** Auto-capture when self-healing resolves an incident */
  captureSelfHealing: boolean;
  /** Detect recurring error patterns and troubleshoot with AI */
  captureErrorPatterns: boolean;
  /** Use AI to research new devices (opt-in — costs API tokens) */
  useAIResearch: boolean;
  /** Use AI to diagnose and attempt to fix error patterns */
  aiErrorTroubleshooting: boolean;
}

export type NotificationSeverity = 'info' | 'warning' | 'error' | 'resolved' | 'bug-report';

export interface KBCaptureNotification {
  id: string;
  message: string;
  detail?: string;
  severity: NotificationSeverity;
  productId?: string;
  /** For bug reports — full diagnostic report text */
  bugReport?: string;
  /** Whether this has been dismissed from the dashboard */
  dismissed: boolean;
  timestamp: number;
}

interface KBCaptureState {
  settings: KBCaptureSettings;

  /** Track recently captured device addresses → timestamp (24h cooldown) */
  recentCaptures: Record<string, number>;
  /** Track captured error pattern hashes (avoid duplicates) */
  capturedErrorHashes: string[];
  /** Previously seen device addresses (for new-device detection) */
  knownDeviceAddresses: string[];
  /** All notifications (toasts + dashboard + history) */
  notifications: KBCaptureNotification[];
  /** Whether the initial error scan at launch has run */
  initialScanDone: boolean;

  // ── Actions ─────────────────────────────────────────────
  updateSettings: (partial: Partial<KBCaptureSettings>) => void;
  addNotification: (
    message: string,
    severity: NotificationSeverity,
    opts?: { detail?: string; productId?: string; bugReport?: string },
  ) => void;
  dismissNotification: (id: string) => void;
  dismissAll: () => void;
  setKnownDevices: (addresses: string[]) => void;
  trackCapture: (deviceAddress: string) => void;
  trackErrorHash: (hash: string) => void;
  isRecentlyCaptured: (deviceAddress: string) => boolean;
  hasErrorHash: (hash: string) => boolean;
  setInitialScanDone: () => void;
  /** Active (undismissed) dashboard notifications */
  getActiveNotifications: () => KBCaptureNotification[];
  /** Count of active undismissed notifications (for sidebar badge) */
  getActiveCount: () => number;
}

// ─── Constants ────────────────────────────────────────────────

const STORAGE_KEY = 'eisy-kb-capture-settings';
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_NOTIFICATIONS = 50;

let notificationCounter = 0;

// ─── Persistence ──────────────────────────────────────────────

function saveSettings(settings: KBCaptureSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage might be unavailable
  }
}

function loadSettings(): KBCaptureSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KBCaptureSettings) : null;
  } catch {
    return null;
  }
}

const DEFAULT_SETTINGS: KBCaptureSettings = {
  enabled: true,
  captureNewDevices: true,
  captureSelfHealing: true,
  captureErrorPatterns: true,
  useAIResearch: true, // enabled by default — generates rich device documentation
  aiErrorTroubleshooting: true,
};

// ─── Store ────────────────────────────────────────────────────

export const useKBCaptureStore = create<KBCaptureState>((set, get) => ({
  settings: loadSettings() ?? DEFAULT_SETTINGS,
  recentCaptures: {},
  capturedErrorHashes: [],
  knownDeviceAddresses: [],
  notifications: [],
  initialScanDone: false,

  updateSettings: (partial) => {
    const updated = { ...get().settings, ...partial };
    set({ settings: updated });
    saveSettings(updated);
  },

  addNotification: (message, severity, opts) => {
    const notification: KBCaptureNotification = {
      id: `kb_notif_${Date.now()}_${++notificationCounter}`,
      message,
      severity,
      detail: opts?.detail,
      productId: opts?.productId,
      bugReport: opts?.bugReport,
      dismissed: false,
      timestamp: Date.now(),
    };
    set((s) => ({
      notifications: [notification, ...s.notifications].slice(0, MAX_NOTIFICATIONS),
    }));
  },

  dismissNotification: (id) => {
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, dismissed: true } : n,
      ),
    }));
  },

  dismissAll: () => {
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, dismissed: true })),
    }));
  },

  setKnownDevices: (addresses) => {
    set({ knownDeviceAddresses: addresses });
  },

  trackCapture: (deviceAddress) => {
    set((s) => ({
      recentCaptures: { ...s.recentCaptures, [deviceAddress]: Date.now() },
    }));
  },

  trackErrorHash: (hash) => {
    set((s) => ({
      capturedErrorHashes: [...s.capturedErrorHashes, hash],
    }));
  },

  isRecentlyCaptured: (deviceAddress) => {
    const ts = get().recentCaptures[deviceAddress];
    if (!ts) return false;
    return Date.now() - ts < COOLDOWN_MS;
  },

  hasErrorHash: (hash) => {
    return get().capturedErrorHashes.includes(hash);
  },

  setInitialScanDone: () => {
    set({ initialScanDone: true });
  },

  getActiveNotifications: () => {
    return get().notifications.filter((n) => !n.dismissed);
  },

  getActiveCount: () => {
    return get().notifications.filter((n) => !n.dismissed).length;
  },
}));
