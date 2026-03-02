/**
 * Top bar with mobile menu toggle, breadcrumbs, search, theme, legend, and AI chat buttons.
 */
import { useLocation } from 'react-router-dom';
import { Search, Moon, Sun, MessageSquare, Menu, HelpCircle } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store.ts';
import { useAIStore } from '@/stores/ai-store.ts';

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/devices': 'Devices',
  '/scenes': 'Scenes',
  '/programs': 'Programs',
  '/logs': 'Logs',
  '/network': 'Network Health',
  '/settings': 'Settings',
};

export function TopBar() {
  const location = useLocation();
  const { theme, setTheme, toggleSearch, toggleMobileSidebar, toggleLegend } = useUIStore();
  const toggleAIPanel = useAIStore((s) => s.togglePanel);

  const pageLabel = ROUTE_LABELS[location.pathname] ?? 'Super eisy';
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-3 sm:px-4 dark:border-gray-800 dark:bg-gray-900">
      {/* Left: mobile menu + breadcrumbs */}
      <div className="flex items-center gap-2">
        {/* Mobile hamburger menu */}
        <button
          onClick={toggleMobileSidebar}
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 md:hidden dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <h2 className="text-base font-semibold text-gray-900 sm:text-lg dark:text-gray-100">{pageLabel}</h2>
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Search */}
        <button
          onClick={toggleSearch}
          className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-50 sm:px-3 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label="Search (Ctrl+K)"
        >
          <Search size={16} />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400 lg:inline dark:bg-gray-800">
            Ctrl+K
          </kbd>
        </button>

        {/* Icon legend */}
        <button
          onClick={toggleLegend}
          className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label="Icon legend"
          title="Icon legend"
        >
          <HelpCircle size={18} />
        </button>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* AI Chat toggle */}
        <button
          onClick={toggleAIPanel}
          className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label="Toggle AI assistant"
        >
          <MessageSquare size={18} />
        </button>
      </div>
    </header>
  );
}
