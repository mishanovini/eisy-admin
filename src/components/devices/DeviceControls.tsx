/**
 * Contextual device controls based on device category.
 * Renders the appropriate control widget: dimmer slider, toggle, lock buttons, etc.
 *
 * All controls are fully reactive to live status updates:
 * - Button colors reflect current on/off/locked state (driven by props)
 * - Dimmer slider syncs with external value changes (via useEffect)
 * - Buttons show a brief pulse animation on press for tactile feedback
 * - Pending state shows a spinner overlay while command is in-flight
 */
import { useState, useEffect, useRef } from 'react';
import {
  Power,
  PowerOff,
  Lock,
  Unlock,
  Fan,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import type { ControlType } from '@/utils/device-types.ts';
import { CMD } from '@/api/types.ts';
import { ConfirmDialog } from '@/components/common/ConfirmDialog.tsx';
import { useConfirm } from '@/hooks/useConfirm.ts';

interface DeviceControlsProps {
  controlType: ControlType;
  currentValue: number;
  onCommand: (command: string, value?: number) => Promise<boolean>;
  onRefresh: () => Promise<boolean>;
}

export function DeviceControls({
  controlType,
  currentValue,
  onCommand,
  onRefresh,
}: DeviceControlsProps) {
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmProps, confirm] = useConfirm();

  const exec = async (command: string, value?: number) => {
    // Confirmation for unlock — destructive/security-sensitive action
    if (command === CMD.UNLOCK) {
      const ok = await confirm({
        title: 'Unlock Device?',
        message: 'This will unlock the device. Make sure this is intentional.',
        confirmLabel: 'Unlock',
        variant: 'warning',
      });
      if (!ok) return;
    }

    setPending(true);
    try {
      await onCommand(command, value);
    } finally {
      setPending(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-3">
      {controlType === 'dimmer' && (
        <DimmerControl value={currentValue} onCommand={exec} pending={pending} />
      )}

      {controlType === 'toggle' && (
        <ToggleControl value={currentValue} onCommand={exec} pending={pending} />
      )}

      {controlType === 'lock' && (
        <LockControl value={currentValue} onCommand={exec} pending={pending} />
      )}

      {controlType === 'fan' && (
        <FanControl value={currentValue} onCommand={exec} pending={pending} />
      )}

      {controlType === 'button' && (
        <ButtonControl onCommand={exec} pending={pending} />
      )}

      {/* Refresh button for all device types */}
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
      >
        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        Query Device
      </button>

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}

// ─── Shared button animation hook ────────────────────────────

/** Returns a ref + className for brief "pressed" pulse animation on click */
function usePulse() {
  const [pulsing, setPulsing] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const triggerPulse = () => {
    setPulsing(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setPulsing(false), 150);
  };

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  return { pulsing, triggerPulse };
}

/** Button wrapper that adds pulse + pending spinner overlay */
function ControlButton({
  onClick,
  pending,
  active,
  activeClassName,
  inactiveClassName,
  title,
  children,
}: {
  onClick: () => void;
  pending: boolean;
  active: boolean;
  activeClassName: string;
  inactiveClassName: string;
  title?: string;
  children: React.ReactNode;
}) {
  const { pulsing, triggerPulse } = usePulse();

  return (
    <button
      onClick={() => {
        triggerPulse();
        onClick();
      }}
      disabled={pending}
      title={title}
      className={`relative flex items-center gap-1 rounded text-xs font-medium transition-all duration-150 ${
        pulsing ? 'scale-95' : ''
      } ${pending ? 'opacity-70' : ''} ${active ? activeClassName : inactiveClassName}`}
    >
      {children}
      {pending && (
        <Loader2 size={12} className="absolute right-1 animate-spin opacity-60" />
      )}
    </button>
  );
}

// ─── Dimmer ──────────────────────────────────────────────────

/** Dimmer slider with On/Off buttons and percentage display */
function DimmerControl({
  value,
  onCommand,
  pending,
}: {
  value: number;
  onCommand: (cmd: string, val?: number) => void;
  pending: boolean;
}) {
  const [sliderValue, setSliderValue] = useState(
    value === 0 ? 0 : Math.round((value / 255) * 100),
  );
  const [isDragging, setIsDragging] = useState(false);
  const isOn = value > 0;

  // Sync slider with external value changes (WebSocket / optimistic updates)
  // Only sync when the user isn't actively dragging the slider
  useEffect(() => {
    if (!isDragging) {
      setSliderValue(value === 0 ? 0 : Math.round((value / 255) * 100));
    }
  }, [value, isDragging]);

  const handleSliderCommit = () => {
    setIsDragging(false);
    if (sliderValue === 0) {
      onCommand(CMD.DOF);
    } else {
      // Convert percentage to 0-255 range for ISY
      const isyValue = Math.round((sliderValue / 100) * 255);
      onCommand(CMD.DON, isyValue);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ControlButton
          onClick={() => onCommand(CMD.DON, 255)}
          pending={pending}
          active={isOn}
          activeClassName="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 px-3 py-1.5"
          inactiveClassName="bg-gray-100 text-gray-600 hover:bg-green-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-green-900/20 px-3 py-1.5"
          title="Turn On (100%)"
        >
          <Power size={14} /> On
        </ControlButton>
        <ControlButton
          onClick={() => onCommand(CMD.DOF)}
          pending={pending}
          active={!isOn}
          activeClassName="bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 px-3 py-1.5"
          inactiveClassName="bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 px-3 py-1.5"
          title="Turn Off"
        >
          <PowerOff size={14} /> Off
        </ControlButton>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          value={sliderValue}
          onChange={(e) => {
            setIsDragging(true);
            setSliderValue(Number(e.target.value));
          }}
          onMouseUp={handleSliderCommit}
          onTouchEnd={handleSliderCommit}
          disabled={pending}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-blue-600 dark:bg-gray-700"
        />
        <span className="w-10 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
          {sliderValue}%
        </span>
      </div>
    </div>
  );
}

// ─── Toggle ──────────────────────────────────────────────────

/** Simple on/off toggle */
function ToggleControl({
  value,
  onCommand,
  pending,
}: {
  value: number;
  onCommand: (cmd: string) => void;
  pending: boolean;
}) {
  const isOn = value > 0;

  return (
    <div className="flex items-center gap-2">
      <ControlButton
        onClick={() => onCommand(CMD.DON)}
        pending={pending}
        active={isOn}
        activeClassName="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 px-4 py-2 text-sm"
        inactiveClassName="bg-gray-100 text-gray-600 hover:bg-green-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-green-900/20 px-4 py-2 text-sm"
      >
        <Power size={16} /> On
      </ControlButton>
      <ControlButton
        onClick={() => onCommand(CMD.DOF)}
        pending={pending}
        active={!isOn}
        activeClassName="bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 px-4 py-2 text-sm"
        inactiveClassName="bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 px-4 py-2 text-sm"
      >
        <PowerOff size={16} /> Off
      </ControlButton>
    </div>
  );
}

// ─── Lock ────────────────────────────────────────────────────

/** Lock/Unlock buttons */
function LockControl({
  value,
  onCommand,
  pending,
}: {
  value: number;
  onCommand: (cmd: string) => void;
  pending: boolean;
}) {
  const isLocked = value >= 100;

  return (
    <div className="flex items-center gap-2">
      <ControlButton
        onClick={() => onCommand(CMD.LOCK)}
        pending={pending}
        active={isLocked}
        activeClassName="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 px-4 py-2 text-sm"
        inactiveClassName="bg-gray-100 text-gray-600 hover:bg-green-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-green-900/20 px-4 py-2 text-sm"
      >
        <Lock size={16} /> Lock
      </ControlButton>
      <ControlButton
        onClick={() => onCommand(CMD.UNLOCK)}
        pending={pending}
        active={!isLocked}
        activeClassName="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 px-4 py-2 text-sm"
        inactiveClassName="bg-gray-100 text-gray-600 hover:bg-amber-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-amber-900/20 px-4 py-2 text-sm"
      >
        <Unlock size={16} /> Unlock
      </ControlButton>
    </div>
  );
}

// ─── Fan ─────────────────────────────────────────────────────

/** Fan speed controls (Off/Low/Medium/High) */
function FanControl({
  value,
  onCommand,
  pending,
}: {
  value: number;
  onCommand: (cmd: string, val?: number) => void;
  pending: boolean;
}) {
  const speeds = [
    { label: 'Off', value: 0, command: CMD.DOF },
    { label: 'Low', value: 64, command: CMD.DON },
    { label: 'Med', value: 128, command: CMD.DON },
    { label: 'High', value: 255, command: CMD.DON },
  ];

  const currentSpeed = value === 0 ? 0 : value <= 85 ? 64 : value <= 170 ? 128 : 255;

  return (
    <div className="flex items-center gap-1">
      {speeds.map((speed) => (
        <ControlButton
          key={speed.label}
          onClick={() =>
            speed.value === 0
              ? onCommand(speed.command)
              : onCommand(speed.command, speed.value)
          }
          pending={pending}
          active={currentSpeed === speed.value}
          activeClassName="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 px-3 py-1.5"
          inactiveClassName="bg-gray-100 text-gray-600 hover:bg-blue-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-blue-900/20 px-3 py-1.5"
        >
          {speed.label !== 'Off' && <Fan size={12} />}
          {speed.label}
        </ControlButton>
      ))}
    </div>
  );
}

// ─── Button ──────────────────────────────────────────────────

/** Simple button trigger (for IR commands, etc.) */
function ButtonControl({
  onCommand,
  pending,
}: {
  onCommand: (cmd: string) => void;
  pending: boolean;
}) {
  const { pulsing, triggerPulse } = usePulse();

  return (
    <button
      onClick={() => {
        triggerPulse();
        onCommand(CMD.DON);
      }}
      disabled={pending}
      className={`flex items-center gap-1 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:bg-blue-700 disabled:opacity-50 ${
        pulsing ? 'scale-95' : ''
      }`}
    >
      {pending ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
      Trigger
    </button>
  );
}
