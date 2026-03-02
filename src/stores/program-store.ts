/**
 * Program store — programs and D2D trigger data.
 * Summaries from /rest/programs, full definitions from SOAP GetAllD2D.
 */
import { create } from 'zustand';
import type { IsyProgram, D2DTrigger } from '@/api/types.ts';
import { fetchPrograms } from '@/api/rest.ts';
import { getAllD2D } from '@/api/soap.ts';

interface ProgramState {
  /** Program summaries (from REST) */
  programs: IsyProgram[];
  /** Full D2D trigger definitions (from SOAP) */
  triggers: D2DTrigger[];
  /** Current D2D session key (needed for writes) */
  d2dKey: string;
  loading: boolean;
  lastFetched: number | null;

  /** Fetch program summaries */
  fetchPrograms: () => Promise<void>;
  /** Fetch full D2D data (programs with conditions/actions) */
  fetchD2D: () => Promise<void>;
  /** Fetch both summaries and D2D */
  fetchAll: () => Promise<void>;
  /** Get a program summary by ID */
  getProgram: (id: string) => IsyProgram | undefined;
  /** Get a D2D trigger by ID */
  getTrigger: (id: number) => D2DTrigger | undefined;
}

export const useProgramStore = create<ProgramState>((set, get) => ({
  programs: [],
  triggers: [],
  d2dKey: '',
  loading: false,
  lastFetched: null,

  fetchPrograms: async () => {
    set({ loading: true });
    const programs = await fetchPrograms();
    set({ programs, loading: false, lastFetched: Date.now() });
  },

  fetchD2D: async () => {
    set({ loading: true });
    const d2d = await getAllD2D();
    if (d2d) {
      set({ triggers: d2d.triggers, d2dKey: d2d.key, loading: false });
    } else {
      set({ loading: false });
    }
  },

  fetchAll: async () => {
    set({ loading: true });
    const [programs, d2d] = await Promise.all([
      fetchPrograms(),
      getAllD2D(),
    ]);
    set({
      programs,
      triggers: d2d?.triggers ?? [],
      d2dKey: d2d?.key ?? '',
      loading: false,
      lastFetched: Date.now(),
    });
  },

  getProgram: (id) => get().programs.find((p) => p['@_id'] === id),
  getTrigger: (id) => get().triggers.find((t) => t.id === id),
}));
