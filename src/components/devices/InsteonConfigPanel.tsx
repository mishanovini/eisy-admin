/**
 * Insteon device configuration panel — property dropdowns + extended command toolbar.
 *
 * Matches UDAC's device configuration layout:
 * - On Level, Ramp Rate, Backlight dropdowns (dimmers + keypads only)
 * - Extended command buttons: Fast On, Fast Off, Brighten, Dim, Fade Stop, Query, Beep, Write Changes
 *
 * This panel is only rendered for Insteon devices (protocolFamily === 'insteon').
 */
import { useState } from 'react';
import {
  Zap,
  ZapOff,
  ArrowUp,
  ArrowDown,
  Pause,
  Search,
  Bell,
  Save,
  Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useStatusStore } from '@/stores/status-store.ts';
import { getOnLevelOptions, getRampRateOptions } from '@/utils/scene-utils.ts';
import { writeDeviceUpdates } from '@/api/soap.ts';
import { CMD } from '@/api/types.ts';
import type { DeviceCategory } from '@/utils/device-types.ts';

interface InsteonConfigPanelProps {
  address: string;
  category: DeviceCategory;
  nodeDefId?: string;
  sendCommand: (command: string, value?: number) => Promise<boolean>;
  setProperty: (propId: string, value: number) => Promise<boolean>;
  onRefresh: () => Promise<boolean>;
}

/**
 * Whether this node is a keypad BUTTON (scene controller only, no load).
 * Keypad buttons (e.g., "KeypadButton_ADV") don't have Ramp Rate or Backlight —
 * they just toggle scenes. Only the main keypad node (e.g., "KeypadDimmer_ADV")
 * controls a physical load and has configurable OL/RR/BL.
 */
function isKeypadButton(nodeDefId?: string): boolean {
  return !!nodeDefId && /button/i.test(nodeDefId);
}

/**
 * Whether to show property dropdowns (On Level, Ramp Rate, Backlight).
 * Dimmers and main keypad nodes (not buttons) have load-control properties.
 */
function showPropertyDropdowns(category: DeviceCategory, nodeDefId?: string): boolean {
  if (category === 'keypad' && isKeypadButton(nodeDefId)) return false;
  return category === 'dimmer' || category === 'keypad';
}

export function InsteonConfigPanel({
  address,
  category,
  nodeDefId,
  sendCommand,
  setProperty,
  onRefresh,
}: InsteonConfigPanelProps) {
  return (
    <div className="space-y-4">
      {/* Property dropdowns — for dimmers and main keypad nodes (not buttons) */}
      {showPropertyDropdowns(category, nodeDefId) && (
        <PropertyDropdowns address={address} setProperty={setProperty} />
      )}

      {/* Extended command toolbar — for all Insteon devices */}
      <CommandToolbar
        address={address}
        sendCommand={sendCommand}
        onRefresh={onRefresh}
      />
    </div>
  );
}

// ─── Property Dropdowns ──────────────────────────────────────

function PropertyDropdowns({
  address,
  setProperty,
}: {
  address: string;
  setProperty: (propId: string, value: number) => Promise<boolean>;
}) {
  // Select raw Map entries directly — avoid calling store methods in selectors
  const olProp = useStatusStore((s) => s.properties.get(String(address))?.get('OL'));
  const rrProp = useStatusStore((s) => s.properties.get(String(address))?.get('RR'));
  const blProp = useStatusStore((s) => s.properties.get(String(address))?.get('BL'));

  const olValue = olProp ? Number(olProp['@_value']) : 255;
  const rrValue = rrProp ? Number(rrProp['@_value']) : 28;
  const blValue = blProp ? Number(blProp['@_value']) : 0;

  const onLevelOptions = getOnLevelOptions();
  const rampRateOptions = getRampRateOptions();

  // Build backlight options (0-100, common values)
  const backlightOptions = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => ({
    value: Math.round((v / 100) * 255),
    label: v === 0 ? 'Off' : `${v}%`,
  }));

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Device Properties
      </h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {/* On Level */}
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
            On Level
          </label>
          <select
            value={findClosestOnLevel(olValue, onLevelOptions)}
            onChange={(e) => setProperty('OL', Number(e.target.value))}
            className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            {onLevelOptions.map((opt) => (
              <option key={opt.level255} value={opt.level255}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Ramp Rate */}
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
            Ramp Rate
          </label>
          <select
            value={rrValue}
            onChange={(e) => setProperty('RR', Number(e.target.value))}
            className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            {rampRateOptions.map((opt) => (
              <option key={opt.index} value={opt.index}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Backlight */}
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
            Backlight
          </label>
          <select
            value={findClosestBacklight(blValue, backlightOptions)}
            onChange={(e) => setProperty('BL', Number(e.target.value))}
            className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            {backlightOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/** Find the closest on-level option value to match the current property */
function findClosestOnLevel(
  value: number,
  options: ReturnType<typeof getOnLevelOptions>,
): number {
  let closest = options[0]!.level255;
  let minDiff = Math.abs(value - closest);
  for (const opt of options) {
    const diff = Math.abs(value - opt.level255);
    if (diff < minDiff) {
      minDiff = diff;
      closest = opt.level255;
    }
  }
  return closest;
}

/** Find the closest backlight option value */
function findClosestBacklight(
  value: number,
  options: { value: number; label: string }[],
): number {
  let closest = options[0]!.value;
  let minDiff = Math.abs(value - closest);
  for (const opt of options) {
    const diff = Math.abs(value - opt.value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = opt.value;
    }
  }
  return closest;
}

// ─── Command Toolbar ─────────────────────────────────────────

interface CmdButton {
  label: string;
  icon: LucideIcon;
  action: () => Promise<boolean | void>;
  title: string;
}

function CommandToolbar({
  address,
  sendCommand,
  onRefresh,
}: {
  address: string;
  sendCommand: (command: string, value?: number) => Promise<boolean>;
  onRefresh: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const buttons: CmdButton[] = [
    { label: 'Fast On', icon: Zap, action: () => sendCommand(CMD.DFON), title: 'Fast On (instant, no ramp)' },
    { label: 'Fast Off', icon: ZapOff, action: () => sendCommand(CMD.DFOF), title: 'Fast Off (instant, no ramp)' },
    { label: 'Brighten', icon: ArrowUp, action: () => sendCommand(CMD.FDUP), title: 'Brighten one step' },
    { label: 'Dim', icon: ArrowDown, action: () => sendCommand(CMD.FDDOWN), title: 'Dim one step' },
    { label: 'Fade Stop', icon: Pause, action: () => sendCommand(CMD.FDSTOP), title: 'Stop fade in progress' },
    { label: 'Query', icon: Search, action: () => onRefresh(), title: 'Query device for current status' },
    { label: 'Beep', icon: Bell, action: () => sendCommand(CMD.BEEP), title: 'Make device beep' },
    {
      label: 'Write',
      icon: Save,
      action: async () => {
        const result = await writeDeviceUpdates(address);
        return result.success;
      },
      title: 'Write pending configuration changes to device',
    },
  ];

  const handleClick = async (btn: CmdButton) => {
    setBusy(btn.label);
    try {
      await btn.action();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Extended Commands
      </h4>
      <div className="flex flex-wrap gap-1">
        {buttons.map((btn) => {
          const Icon = btn.icon;
          const isBusy = busy === btn.label;
          return (
            <button
              key={btn.label}
              onClick={() => handleClick(btn)}
              disabled={busy !== null}
              title={btn.title}
              className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition-all duration-150
                ${isBusy
                  ? 'border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800'
                }
                ${busy !== null && !isBusy ? 'opacity-50' : ''}
              `}
            >
              {isBusy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Icon size={12} />
              )}
              {btn.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
