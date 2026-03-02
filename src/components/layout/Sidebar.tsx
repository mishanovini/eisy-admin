/**
 * Collapsible navigation sidebar with route links.
 * Desktop: persistent sidebar (collapsible). Mobile: overlay drawer.
 */
import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Network,
  Layers,
  Code2,
  ScrollText,
  Settings,
  Wifi,
  ChevronLeft,
  ChevronRight,
  Activity,
  Wrench,
  Calendar,
  BookOpen,
  Battery,
  X,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui-store.ts';
import { useKBCaptureStore } from '@/stores/kb-capture-store.ts';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { path: '/devices', label: 'Devices', icon: <Network size={20} /> },
  { path: '/scenes', label: 'Scenes', icon: <Layers size={20} /> },
  { path: '/programs', label: 'Programs', icon: <Code2 size={20} /> },
  { path: '/logs', label: 'Logs', icon: <ScrollText size={20} /> },
  { path: '/schedule', label: 'Schedule', icon: <Calendar size={20} /> },
  { path: '/network', label: 'Network Health', icon: <Activity size={20} /> },
  { path: '/batteries', label: 'Batteries', icon: <Battery size={20} /> },
  { path: '/troubleshoot', label: 'Troubleshooter', icon: <Wrench size={20} /> },
  { path: '/knowledge', label: 'Knowledge Base', icon: <BookOpen size={20} /> },
  { path: '/settings', label: 'Settings', icon: <Settings size={20} /> },
];

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const mobileSidebarOpen = useUIStore((s) => s.mobileSidebarOpen);
  const closeMobileSidebar = useUIStore((s) => s.closeMobileSidebar);
  const location = useLocation();
  const kbActiveCount = useKBCaptureStore((s) => s.getActiveCount());

  // Close mobile sidebar on route change
  useEffect(() => {
    closeMobileSidebar();
  }, [location.pathname, closeMobileSidebar]);

  const navContent = (
    <>
      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `mx-2 mb-1 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
              }`
            }
            title={item.label}
          >
            <span className="relative flex-shrink-0">
              {item.icon}
              {item.path === '/knowledge' && kbActiveCount > 0 && (
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-blue-500" />
              )}
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Version */}
      <div className="border-t border-gray-200 px-4 py-2 dark:border-gray-800">
        <p className="text-xs text-gray-400 dark:text-gray-500">Super eisy v0.1.0</p>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <aside
        className={`hidden md:flex flex-col border-r border-gray-200 bg-white transition-all duration-200 dark:border-gray-800 dark:bg-gray-900 ${
          sidebarOpen ? 'w-56' : 'w-14'
        }`}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-gray-200 px-3 dark:border-gray-800">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <Wifi size={20} className="text-blue-600" />
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">eisy</span>
            </div>
          )}
          <button
            onClick={toggleSidebar}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>

        {/* Desktop nav — collapsed shows icons only */}
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `mx-2 mb-1 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                }`
              }
              title={item.label}
            >
              <span className="relative flex-shrink-0">
                {item.icon}
                {item.path === '/knowledge' && kbActiveCount > 0 && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-blue-500" />
                )}
              </span>
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {sidebarOpen && (
          <div className="border-t border-gray-200 px-4 py-2 dark:border-gray-800">
            <p className="text-xs text-gray-400 dark:text-gray-500">Super eisy v0.1.0</p>
          </div>
        )}
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={closeMobileSidebar} />

          {/* Drawer */}
          <aside className="relative flex h-full w-64 flex-col bg-white shadow-xl dark:bg-gray-900">
            {/* Mobile header */}
            <div className="flex h-14 items-center justify-between border-b border-gray-200 px-3 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Wifi size={20} className="text-blue-600" />
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">eisy</span>
              </div>
              <button
                onClick={closeMobileSidebar}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>

            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}
