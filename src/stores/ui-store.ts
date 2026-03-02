/**
 * UI store — user preferences, panel states, and selection tracking.
 */
import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';

interface UIState {
  theme: ThemeMode;
  sidebarOpen: boolean;
  sidebarWidth: number;
  mobileSidebarOpen: boolean;
  legendOpen: boolean;
  selectedNodeAddress: string | null;
  selectedProgramId: string | null;
  searchOpen: boolean;
  searchQuery: string;

  setTheme: (theme: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  toggleLegend: () => void;
  selectNode: (address: string | null) => void;
  selectProgram: (id: string | null) => void;
  toggleSearch: () => void;
  setSearchQuery: (query: string) => void;
  /** Restore preferences from localStorage */
  restore: () => void;
}

const STORAGE_KEY = 'eisy-ui-prefs';

function applyTheme(theme: ThemeMode): void {
  const isDark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'system',
  sidebarOpen: true,
  sidebarWidth: 280,
  mobileSidebarOpen: false,
  legendOpen: false,
  selectedNodeAddress: null,
  selectedProgramId: null,
  searchOpen: false,
  searchQuery: '',

  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme }));
    } catch {
      // ignore
    }
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  toggleMobileSidebar: () => set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen })),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
  toggleLegend: () => set((s) => ({ legendOpen: !s.legendOpen })),
  selectNode: (selectedNodeAddress) => set({ selectedNodeAddress }),
  selectProgram: (selectedProgramId) => set({ selectedProgramId }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen, searchQuery: '' })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  restore: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const prefs = JSON.parse(raw) as { theme?: ThemeMode };
        if (prefs.theme) {
          set({ theme: prefs.theme });
          applyTheme(prefs.theme);
        }
      }
    } catch {
      // ignore
    }
    // Apply current theme on restore
    applyTheme(get().theme);
  },
}));
