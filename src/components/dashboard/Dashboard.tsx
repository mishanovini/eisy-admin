/**
 * Dashboard — at-a-glance overview of the eisy system.
 * Shows battery status, active programs, recent events, and system info.
 */
import { useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Battery,
  BatteryWarning,
  BatteryLow,
  Wifi,
  Play,
  Activity,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Bug,
  BookOpen,
  Zap,
  Clock,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useStatusStore } from '@/stores/status-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import { useLogStore, type LogEntry } from '@/stores/log-store.ts';
import { useConnectionStore } from '@/stores/connection-store.ts';
import {
  useKBCaptureStore,
  type KBCaptureNotification,
  type NotificationSeverity,
} from '@/stores/kb-capture-store.ts';
import { getDeviceTypeInfo, getBatteryStatus, type DeviceCategory } from '@/utils/device-types.ts';
import { boolAttr } from '@/utils/xml-parser.ts';

export function DashboardPage() {
  const navigate = useNavigate();
  const nodes = useDeviceStore((s) => s.nodes);
  const properties = useStatusStore((s) => s.properties);
  const programs = useProgramStore((s) => s.programs);
  const logEntries = useLogStore((s) => s.entries);
  const loadEntries = useLogStore((s) => s.loadEntries);
  const config = useConnectionStore((s) => s.config);

  // Load recent log entries on mount
  useEffect(() => {
    loadEntries({ limit: 20 });
  }, [loadEntries]);

  const batteries = useMemo(() => getBatteryDevices(nodes, properties), [nodes, properties]);
  const activePrograms = useMemo(
    () => programs.filter((p) => p['@_running'] === 'running' || p['@_running'] === 'then' || p['@_running'] === 'else'),
    [programs],
  );
  const enabledCount = useMemo(
    () => programs.filter((p) => boolAttr(p['@_enabled']) && !boolAttr(p['@_folder'])).length,
    [programs],
  );
  const recentEvents = logEntries.slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {config?.platform ?? 'eisy'} &middot; {nodes.length} devices &middot; {enabledCount} programs enabled
          </p>
        </div>
        <button
          onClick={() => loadEntries({ limit: 20 })}
          className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Notification Banner — persistent, scrollable, dismissible */}
      <NotificationBanner />

      {/* Stats row — all clickable, linking to detail pages */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Zap size={20} className="text-blue-500" />} label="Devices" value={nodes.length} bg="bg-blue-50 dark:bg-blue-900/20" onClick={() => navigate('/devices')} />
        <StatCard icon={<Activity size={20} className="text-green-500" />} label="Programs" value={enabledCount} sub={activePrograms.length > 0 ? `${activePrograms.length} running` : undefined} bg="bg-green-50 dark:bg-green-900/20" onClick={() => navigate('/programs')} />
        <StatCard icon={<BatteryWarning size={20} className="text-amber-500" />} label="Low Batteries" value={batteries.filter((b) => b.status !== 'good').length} sub={batteries.length > 0 ? `${batteries.length} battery devices` : undefined} bg="bg-amber-50 dark:bg-amber-900/20" onClick={() => navigate('/batteries')} />
        <StatCard icon={<Clock size={20} className="text-purple-500" />} label="Recent Events" value={logEntries.length} bg="bg-purple-50 dark:bg-purple-900/20" onClick={() => navigate('/logs')} />
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <BatteryCard batteries={batteries} />
        <ActiveProgramsCard programs={activePrograms} allPrograms={programs} />
        <RecentEventsCard events={recentEvents} />
        <SystemInfoCard config={config} nodeCount={nodes.length} programCount={programs.length} />
      </div>
    </div>
  );
}

/* ─── Stat Card ──────────────────────────────────────────── */

function StatCard({ icon, label, value, sub, bg, onClick }: { icon: React.ReactNode; label: string; value: number; sub?: string; bg: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl p-4 text-left transition-all hover:shadow-md hover:ring-1 hover:ring-gray-200 dark:hover:ring-gray-600 cursor-pointer ${bg}`}
    >
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
        </div>
      </div>
    </button>
  );
}

/* ─── Battery Card ───────────────────────────────────────── */

interface BatteryDevice {
  address: string;
  name: string;
  level: number;
  categoryLabel: string;
  deviceCategory: DeviceCategory;
  status: 'good' | 'low' | 'critical';
}

function getBatteryDevices(
  nodes: ReturnType<typeof useDeviceStore.getState>['nodes'],
  properties: ReturnType<typeof useStatusStore.getState>['properties'],
): BatteryDevice[] {
  const result: BatteryDevice[] = [];
  for (const node of nodes) {
    const nodeProps = properties.get(String(node.address));
    if (!nodeProps) continue;
    const bat = nodeProps.get('BATLVL');
    if (bat) {
      const typeInfo = getDeviceTypeInfo(node['@_nodeDefId'], node.type ? String(node.type) : undefined);
      const level = Number(bat['@_value']);
      result.push({
        address: String(node.address),
        name: node.name,
        level,
        categoryLabel: typeInfo.label,
        deviceCategory: typeInfo.category,
        status: getBatteryStatus(level, typeInfo.category),
      });
    }
  }
  result.sort((a, b) => a.level - b.level);
  return result;
}

function BatteryCard({ batteries }: { batteries: BatteryDevice[] }) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <Battery size={16} className="text-amber-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Battery Status</h3>
        <span className="ml-auto text-xs text-gray-400">{batteries.length} devices</span>
        <button onClick={() => navigate('/batteries')} className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400">View all</button>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {batteries.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">No battery-powered devices found</p>
        )}
        {batteries.map((b) => (
          <div key={b.address} className="flex items-center gap-3 px-4 py-2.5">
            {b.status === 'critical' ? <BatteryLow size={18} className="text-red-500" /> : b.status === 'low' ? <BatteryWarning size={18} className="text-amber-500" /> : <Battery size={18} className="text-green-500" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{b.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{b.categoryLabel}</p>
            </div>
            <div className="text-right">
              <p className={`text-sm font-bold ${b.status === 'critical' ? 'text-red-600 dark:text-red-400' : b.status === 'low' ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                {b.level}%
              </p>
              <BatteryBar level={b.level} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BatteryBar({ level }: { level: number }) {
  const color = level <= 10 ? 'bg-red-500' : level <= 25 ? 'bg-amber-500' : level <= 50 ? 'bg-yellow-400' : 'bg-green-500';
  return (
    <div className="mt-0.5 h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${level}%` }} />
    </div>
  );
}

/* ─── Active Programs Card ───────────────────────────────── */

function ActiveProgramsCard({ programs, allPrograms }: { programs: ReturnType<typeof useProgramStore.getState>['programs']; allPrograms: ReturnType<typeof useProgramStore.getState>['programs'] }) {
  const navigate = useNavigate();
  const enabledNonFolder = allPrograms.filter((p) => boolAttr(p['@_enabled']) && !boolAttr(p['@_folder']));

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <Play size={16} className="text-green-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Programs</h3>
        <span className="ml-auto text-xs text-gray-400">{enabledNonFolder.length} enabled</span>
        <button onClick={() => navigate('/programs')} className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400">View all</button>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {programs.length === 0 && (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-gray-400 dark:text-gray-500">No programs currently running</p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{enabledNonFolder.length} programs enabled and waiting for triggers</p>
          </div>
        )}
        {programs.map((p) => (
          <button key={p['@_id']} onClick={() => navigate('/programs')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/30">
            <Play size={16} className="flex-shrink-0 text-green-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{p.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Running {p['@_running']} &middot; ID {p['@_id']}</p>
            </div>
            <span className="flex-shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">Active</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Recent Events Card ─────────────────────────────────── */

function RecentEventsCard({ events }: { events: LogEntry[] }) {
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <Activity size={16} className="text-blue-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recent Events</h3>
        <button onClick={() => navigate('/logs')} className="ml-auto text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400">View all</button>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {events.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">No recent events</p>
        )}
        {events.map((e, i) => (
          <div key={e.id ?? i} className="flex items-center gap-3 px-4 py-2">
            <Activity size={14} className={`flex-shrink-0 ${e.category === 'command' ? 'text-blue-500' : e.category === 'comms' ? 'text-purple-500' : 'text-amber-500'}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">{e.deviceName ?? e.device ?? '—'}</span> {e.action}
              </p>
            </div>
            <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
            {e.result === 'fail' && <AlertTriangle size={14} className="flex-shrink-0 text-red-500" />}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── System Info Card ───────────────────────────────────── */

function SystemInfoCard({ config, nodeCount, programCount }: { config: ReturnType<typeof useConnectionStore.getState>['config']; nodeCount: number; programCount: number }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <Wifi size={16} className="text-blue-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">System Info</h3>
      </div>
      <div className="space-y-2 px-4 py-3">
        <InfoRow label="Platform" value={config?.platform ?? '—'} />
        <InfoRow label="Firmware" value={config?.app_full_version ?? config?.app_version ?? '—'} />
        <InfoRow label="Devices" value={String(nodeCount)} />
        <InfoRow label="Programs" value={String(programCount)} />
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}

/* ─── Notification Banner ────────────────────────────────── */

/** Severity → icon + colors for the notification banner */
function getNotificationIcon(severity: NotificationSeverity) {
  switch (severity) {
    case 'info':
      return { Icon: BookOpen, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' };
    case 'warning':
      return { Icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' };
    case 'error':
      return { Icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' };
    case 'resolved':
      return { Icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-900/20' };
    case 'bug-report':
      return { Icon: Bug, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20' };
  }
}

function NotificationBanner() {
  const notifications = useKBCaptureStore((s) => s.notifications);
  const activeNotifications = useMemo(() => notifications.filter((n) => !n.dismissed), [notifications]);
  const dismiss = useKBCaptureStore((s) => s.dismissNotification);
  const dismissAll = useKBCaptureStore((s) => s.dismissAll);
  const navigate = useNavigate();

  if (activeNotifications.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      {/* Banner header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-blue-500" />
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Notifications
          </span>
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-100 px-1 text-[10px] font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
            {activeNotifications.length}
          </span>
        </div>
        <button
          onClick={dismissAll}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <XCircle size={12} /> Dismiss all
        </button>
      </div>

      {/* Scrollable notification list — max ~160px before scrolling */}
      <div className="max-h-40 overflow-y-auto">
        {activeNotifications.map((notification: KBCaptureNotification) => {
          const { Icon, color, bg } = getNotificationIcon(notification.severity);
          return (
            <div
              key={notification.id}
              className={`flex items-start gap-2.5 border-b border-gray-100 px-3 py-2 last:border-b-0 dark:border-gray-800 ${bg}`}
            >
              <Icon size={14} className={`mt-0.5 flex-shrink-0 ${color}`} />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  if (notification.productId) navigate('/knowledge');
                }}
              >
                <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
                  {notification.message}
                </p>
                {notification.detail && (
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-gray-500 dark:text-gray-400">
                    {notification.detail}
                  </p>
                )}
                <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                  {new Date(notification.timestamp).toLocaleTimeString()}
                </p>
              </button>
              <button
                onClick={() => dismiss(notification.id)}
                className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-white hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                aria-label="Dismiss notification"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
