/**
 * Portal store — manages ISY Portal (my.isy.io) connection, credentials,
 * and Google Home voice control data.
 *
 * Credential persistence: localStorage (same pattern as connection-store).
 * The portal credentials are separate from the eisy device credentials —
 * the eisy uses local Basic Auth while the portal uses cloud email/password.
 *
 * Data flow:
 *  1. User enters portal email/password → portalLogin() verifies → gets domain ID
 *  2. Credentials saved to localStorage (email, basicAuth, domain, uuid)
 *  3. On app reload, restore() reads localStorage + re-verifies with portal
 *  4. All CRUD operations use cached credentials for portal API calls
 */
import { create } from 'zustand';
import { useConnectionStore } from './connection-store.ts';
import {
  portalLogin,
  portalFetchSpokens,
  portalCreateSpoken,
  portalUpdateSpoken,
  portalDeleteSpoken,
  portalFetchRooms,
  portalCreateRoom,
  portalUpdateRoom,
  portalDeleteRoom,
  portalSyncToGoogle,
  portalDeleteAllSpokens,
} from '@/api/portal.ts';
import type {
  PortalCredentials,
  PortalSpokenNode,
  PortalRoom,
  SpokenNodePayload,
} from '@/api/portal.ts';

// Re-export types for convenience
export type { PortalCredentials, PortalSpokenNode, PortalRoom, SpokenNodePayload };

export type PortalStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface PortalState {
  // ─── Connection ───────────────────────────────────────────
  status: PortalStatus;
  credentials: PortalCredentials | null;
  errorMessage: string | null;

  // ─── Data ─────────────────────────────────────────────────
  spokens: PortalSpokenNode[];
  rooms: PortalRoom[];
  loading: boolean;
  syncing: boolean;

  // ─── Connection actions ───────────────────────────────────
  connect: (email: string, password: string) => Promise<boolean>;
  disconnect: () => void;
  restore: () => Promise<boolean>;

  // ─── Data actions ─────────────────────────────────────────
  fetchSpokens: () => Promise<void>;
  fetchRooms: () => Promise<void>;
  fetchAll: () => Promise<void>;
  createSpoken: (node: SpokenNodePayload) => Promise<boolean>;
  updateSpoken: (node: SpokenNodePayload) => Promise<boolean>;
  deleteSpoken: (id: string) => Promise<boolean>;
  createRoom: (name: string) => Promise<boolean>;
  updateRoom: (id: string, name: string) => Promise<boolean>;
  deleteRoom: (id: string) => Promise<boolean>;
  syncToGoogle: () => Promise<boolean>;
  deleteAllSpokens: () => Promise<boolean>;
}

// ─── localStorage persistence ──────────────────────────────

const STORAGE_KEY = 'eisy-portal';

function saveCredentials(creds: PortalCredentials): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  } catch {
    // localStorage might be unavailable
  }
}

function loadCredentials(): PortalCredentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PortalCredentials;
  } catch {
    return null;
  }
}

function clearCredentials(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ─── Helper: get eisy UUID from connection config ──────────

function getEisyUuid(): string | null {
  const config = useConnectionStore.getState().config;
  return config?.root?.id ?? null;
}

// ─── Store ─────────────────────────────────────────────────

export const usePortalStore = create<PortalState>((set, get) => ({
  status: 'disconnected',
  credentials: null,
  errorMessage: null,
  spokens: [],
  rooms: [],
  loading: false,
  syncing: false,

  connect: async (email, password) => {
    set({ status: 'connecting', errorMessage: null });

    const uuid = getEisyUuid();
    if (!uuid) {
      set({ status: 'error', errorMessage: 'eisy UUID not available — is the device connected?' });
      return false;
    }

    const resp = await portalLogin(email, password);
    if (!resp.ok) {
      set({
        status: 'error',
        errorMessage: resp.error || `Portal returned ${resp.status}`,
      });
      return false;
    }

    // Domain ID lives at user.domain in the login response
    const domain = resp.data?.user?.domain;
    if (!domain) {
      set({
        status: 'error',
        errorMessage: 'Authenticated, but portal response is missing account domain ID. Contact support.',
      });
      return false;
    }

    const creds: PortalCredentials = {
      email,
      basicAuth: btoa(`${email}:${password}`),
      domain,
      uuid,
    };

    set({ status: 'connected', credentials: creds, errorMessage: null });
    saveCredentials(creds);

    // Load data in background
    get().fetchAll();
    return true;
  },

  disconnect: () => {
    clearCredentials();
    set({
      status: 'disconnected',
      credentials: null,
      errorMessage: null,
      spokens: [],
      rooms: [],
    });
  },

  restore: async () => {
    const saved = loadCredentials();
    if (!saved?.basicAuth || !saved?.domain) return false;

    // Update UUID in case it changed (shouldn't, but be safe)
    const uuid = getEisyUuid();
    if (uuid) saved.uuid = uuid;

    set({ status: 'connecting', errorMessage: null });

    // Verify credentials still work by fetching spokens
    const resp = await portalFetchSpokens(saved);
    if (!resp.ok) {
      // Credentials might be stale — don't clear yet, let user re-login
      set({ status: 'disconnected', errorMessage: null });
      return false;
    }

    const spokens = Array.isArray(resp.data) ? resp.data : [];
    set({ status: 'connected', credentials: saved, spokens });

    // Save updated creds (with refreshed uuid) and load rooms in background
    saveCredentials(saved);
    get().fetchRooms();
    return true;
  },

  // ─── Data fetching ────────────────────────────────────────

  fetchSpokens: async () => {
    const creds = get().credentials;
    if (!creds) return;
    set({ loading: true });

    const resp = await portalFetchSpokens(creds);
    if (resp.ok) {
      set({ spokens: Array.isArray(resp.data) ? resp.data : [], loading: false });
    } else {
      set({ loading: false });
    }
  },

  fetchRooms: async () => {
    const creds = get().credentials;
    if (!creds) return;

    const resp = await portalFetchRooms(creds);
    if (resp.ok) {
      set({ rooms: Array.isArray(resp.data) ? resp.data : [] });
    }
  },

  fetchAll: async () => {
    await Promise.all([get().fetchSpokens(), get().fetchRooms()]);
  },

  // ─── Spoken CRUD ──────────────────────────────────────────

  createSpoken: async (node) => {
    const creds = get().credentials;
    if (!creds) return false;

    const resp = await portalCreateSpoken(creds, node);
    if (resp.ok) {
      // Refresh list to get the portal-assigned _id
      await get().fetchSpokens();
    }
    return resp.ok;
  },

  updateSpoken: async (node) => {
    const creds = get().credentials;
    if (!creds) return false;

    const resp = await portalUpdateSpoken(creds, node);
    if (resp.ok) {
      await get().fetchSpokens();
    }
    return resp.ok;
  },

  deleteSpoken: async (id) => {
    const creds = get().credentials;
    if (!creds) return false;

    const resp = await portalDeleteSpoken(creds, id);
    if (resp.ok) {
      // Optimistic remove from local state
      set((s) => ({ spokens: s.spokens.filter((n) => n._id !== id) }));
    }
    return resp.ok;
  },

  // ─── Room CRUD ────────────────────────────────────────────

  createRoom: async (name) => {
    const creds = get().credentials;
    if (!creds) return false;

    const resp = await portalCreateRoom(creds, name);
    if (resp.ok) {
      await get().fetchRooms();
    }
    return resp.ok;
  },

  updateRoom: async (id, name) => {
    const creds = get().credentials;
    if (!creds) return false;

    const resp = await portalUpdateRoom(creds, id, name);
    if (resp.ok) {
      await get().fetchRooms();
    }
    return resp.ok;
  },

  deleteRoom: async (id) => {
    const creds = get().credentials;
    if (!creds) return false;

    const resp = await portalDeleteRoom(creds, id);
    if (resp.ok) {
      set((s) => ({ rooms: s.rooms.filter((r) => r._id !== id) }));
    }
    return resp.ok;
  },

  // ─── Sync ─────────────────────────────────────────────────

  syncToGoogle: async () => {
    const creds = get().credentials;
    if (!creds) return false;

    set({ syncing: true });
    const resp = await portalSyncToGoogle(creds);
    set({ syncing: false });
    return resp.ok;
  },

  deleteAllSpokens: async () => {
    const creds = get().credentials;
    if (!creds) return false;

    const resp = await portalDeleteAllSpokens(creds);
    if (resp.ok) {
      set({ spokens: [] });
    }
    return resp.ok;
  },
}));
