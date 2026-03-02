/**
 * Icon legend panel — explains the meaning of status icons used throughout the app.
 * Opens as a modal overlay from the TopBar help button.
 */
import { useEffect } from 'react';
import {
  X,
  Circle,
  CircleDot,
  AlertTriangle,
  Battery,
  BatteryLow,
  BatteryWarning,
  Wifi,
  WifiOff,
  Lock,
  Unlock,
  Power,
  PowerOff,
  CheckCircle2,
  XCircle,
  Clock,
  ToggleLeft,
  ToggleRight,
  Fan,
  Lightbulb,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui-store.ts';

interface LegendEntry {
  icon: React.ReactNode;
  label: string;
  description: string;
}

const STATUS_ICONS: LegendEntry[] = [
  { icon: <CircleDot size={16} className="text-green-500" />, label: 'On / Active', description: 'Device is powered on or sensor is active' },
  { icon: <Circle size={16} className="text-gray-400" />, label: 'Off / Inactive', description: 'Device is powered off or sensor is clear' },
  { icon: <AlertTriangle size={16} className="text-red-500" />, label: 'Error / Attention', description: 'Device has an error or needs attention' },
  { icon: <Clock size={16} className="text-amber-500 animate-pulse" />, label: 'Pending', description: 'Waiting for device response or pending writes' },
];

const DEVICE_ICONS: LegendEntry[] = [
  { icon: <Lightbulb size={16} className="text-amber-500" />, label: 'Light / Dimmer', description: 'Light switch or dimmable light' },
  { icon: <Power size={16} className="text-green-500" />, label: 'On', description: 'Turn on or device is on' },
  { icon: <PowerOff size={16} className="text-gray-500" />, label: 'Off', description: 'Turn off or device is off' },
  { icon: <Lock size={16} className="text-green-600" />, label: 'Locked', description: 'Lock is secured' },
  { icon: <Unlock size={16} className="text-amber-600" />, label: 'Unlocked', description: 'Lock is open' },
  { icon: <Fan size={16} className="text-blue-500" />, label: 'Fan', description: 'Fan or motor controller' },
];

const BATTERY_ICONS: LegendEntry[] = [
  { icon: <Battery size={16} className="text-green-500" />, label: 'Battery Good', description: '50% or above' },
  { icon: <BatteryWarning size={16} className="text-amber-500" />, label: 'Battery Low', description: '20\u201350% — consider replacing soon' },
  { icon: <BatteryLow size={16} className="text-red-500" />, label: 'Battery Critical', description: 'Below 20% — replace immediately' },
];

const CONNECTION_ICONS: LegendEntry[] = [
  { icon: <Wifi size={16} className="text-green-500" />, label: 'Connected', description: 'WebSocket connected to eisy' },
  { icon: <Wifi size={16} className="text-amber-500 animate-pulse" />, label: 'Connecting', description: 'Attempting to connect' },
  { icon: <WifiOff size={16} className="text-gray-400" />, label: 'Disconnected', description: 'No connection to eisy' },
];

const PROGRAM_ICONS: LegendEntry[] = [
  { icon: <ToggleRight size={16} className="text-green-500" />, label: 'Enabled', description: 'Program is active and can run' },
  { icon: <ToggleLeft size={16} className="text-gray-400" />, label: 'Disabled', description: 'Program will not run until re-enabled' },
  { icon: <CheckCircle2 size={16} className="text-green-500" />, label: 'Success', description: 'Command executed successfully' },
  { icon: <XCircle size={16} className="text-red-500" />, label: 'Failed', description: 'Command failed to execute' },
];

function LegendSection({ title, entries }: { title: string; entries: LegendEntry[] }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {title}
      </h4>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div key={entry.label} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex-shrink-0">{entry.icon}</span>
            <div className="min-w-0">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{entry.label}</span>
              <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400">— {entry.description}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function IconLegend() {
  const legendOpen = useUIStore((s) => s.legendOpen);
  const toggleLegend = useUIStore((s) => s.toggleLegend);

  useEffect(() => {
    if (!legendOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleLegend();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [legendOpen, toggleLegend]);

  if (!legendOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={toggleLegend} />

      {/* Panel */}
      <div className="relative mx-4 w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Icon Legend</h3>
          <button
            onClick={toggleLegend}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label="Close legend"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          <LegendSection title="Status" entries={STATUS_ICONS} />
          <LegendSection title="Devices" entries={DEVICE_ICONS} />
          <LegendSection title="Battery" entries={BATTERY_ICONS} />
          <LegendSection title="Connection" entries={CONNECTION_ICONS} />
          <LegendSection title="Programs" entries={PROGRAM_ICONS} />
        </div>
      </div>
    </div>
  );
}
