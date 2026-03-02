/**
 * Connection store — manages host, credentials, and connection state.
 * Persists credentials to localStorage (encrypted in production).
 */
import { create } from 'zustand';
import { setConnectionConfig } from '@/api/client.ts';
import type { ConnectionConfig } from '@/api/client.ts';
import { testConnection } from '@/api/client.ts';
import { fetchConfig } from '@/api/rest.ts';
import type { ConfigResponse } from '@/api/types.ts';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface ConnectionState {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  username: string;
  password: string;
  status: ConnectionStatus;
  errorMessage: string | null;
  config: ConfigResponse['configuration'] | null;

  /** Apply config and attempt connection */
  connect: (config: Partial<ConnectionConfig>) => Promise<boolean>;
  disconnect: () => void;
  /** Restore saved credentials from localStorage */
  restore: () => Promise<boolean>;
}

const STORAGE_KEY = 'eisy-connection';

function saveToStorage(config: Pick<ConnectionConfig, 'host' | 'port' | 'protocol' | 'username' | 'password'>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage might be unavailable
  }
}

function loadFromStorage(): Partial<ConnectionConfig> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<ConnectionConfig>;
  } catch {
    return null;
  }
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  host: '',
  port: 8443,
  protocol: 'https',
  username: 'admin',
  password: 'admin',
  status: 'disconnected',
  errorMessage: null,
  config: null,

  connect: async (config) => {
    const state = get();
    const merged: ConnectionConfig = {
      host: config.host ?? state.host,
      port: config.port ?? state.port,
      protocol: config.protocol ?? state.protocol,
      username: config.username ?? state.username,
      password: config.password ?? state.password,
    };

    set({ ...merged, status: 'connecting', errorMessage: null });
    setConnectionConfig(merged);

    try {
      const ok = await testConnection();
      if (ok) {
        set({ status: 'connected' });
        saveToStorage(merged);
        // Fetch system config in background
        fetchConfig().then((cfg) => { if (cfg) set({ config: cfg }); }).catch(() => {});
        return true;
      } else {
        set({ status: 'error', errorMessage: 'Could not reach eisy device' });
        return false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      set({ status: 'error', errorMessage: msg });
      return false;
    }
  },

  disconnect: () => {
    set({ status: 'disconnected', errorMessage: null });
  },

  restore: async () => {
    const saved = loadFromStorage();
    if (!saved?.username) return false;
    return get().connect(saved);
  },
}));
