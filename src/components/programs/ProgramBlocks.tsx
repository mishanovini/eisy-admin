/**
 * Block rendering components for the visual Program Editor.
 * Used internally by ProgramEditor to render condition and action blocks.
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  ChevronUp,
  ChevronDown,
  Search,
  Clock,
  Zap,
  Thermometer,
  Bell,
  Play,
  Pause,
  Power,
  Layers,
} from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';

// ─── Type Definitions ────────────────────────────────────────

export type ConditionType = 'schedule' | 'status' | 'control' | 'group';
export type ActionType = 'cmd' | 'wait' | 'runthen' | 'runelse' | 'runif' | 'enable' | 'disable' | 'notify';
export type LogicOp = 'and' | 'or';

export interface ScheduleCondition {
  type: 'schedule';
  from?: { sunset?: number; sunrise?: number; time?: number };
  to?: { sunset?: number; sunrise?: number; time?: number; nextDay?: boolean };
  daysOfWeek?: string[];
}

export interface StatusCondition {
  type: 'status';
  node: string;
  property: string;
  operator: string;
  value: string;
  uom: string;
}

export interface ControlCondition {
  type: 'control';
  node: string;
  event: string;
}

export interface GroupCondition {
  type: 'group';
  conditions: ConditionBlock[];
}

export interface ConditionBlock {
  id: string;
  logic: LogicOp;
  condition: ScheduleCondition | StatusCondition | ControlCondition | GroupCondition;
}

export interface ActionBlock {
  id: string;
  action: ActionType;
  node?: string;
  command?: string;
  value?: string;
  uom?: string;
  hours?: number;
  minutes?: number;
  seconds?: number;
  programId?: string;
  notifyContent?: string;
  notifyChannel?: string;
}

// ─── Constants ───────────────────────────────────────────────

const OPERATORS = [
  { value: 'IS', label: 'is' },
  { value: 'NOT', label: 'is not' },
  { value: 'GT', label: '>' },
  { value: 'LT', label: '<' },
  { value: 'GTE', label: '>=' },
  { value: 'LTE', label: '<=' },
];

const CONTROL_EVENTS = [
  { value: 'DON', label: 'Switched On' },
  { value: 'DOF', label: 'Switched Off' },
  { value: 'DFON', label: 'Fast On' },
  { value: 'DFOF', label: 'Fast Off' },
];

const DEVICE_COMMANDS = [
  { value: 'DON', label: 'On' },
  { value: 'DOF', label: 'Off' },
  { value: 'DFON', label: 'Fast On' },
  { value: 'DFOF', label: 'Fast Off' },
  { value: 'LOCK', label: 'Lock' },
  { value: 'UNLOCK', label: 'Unlock' },
  { value: 'QUERY', label: 'Query' },
  { value: 'BEEP', label: 'Beep' },
  { value: 'BRT', label: 'Brighten' },
  { value: 'DIM', label: 'Dim' },
];

const COMMON_PROPERTIES = [
  { value: 'ST', label: 'Status' },
  { value: 'BATLVL', label: 'Battery Level' },
  { value: 'CLIHUM', label: 'Humidity' },
  { value: 'CLIMD', label: 'Climate Mode' },
  { value: 'CLISPH', label: 'Heat Setpoint' },
  { value: 'CLISPC', label: 'Cool Setpoint' },
  { value: 'CLIFS', label: 'Fan State' },
  { value: 'OL', label: 'On Level' },
  { value: 'RR', label: 'Ramp Rate' },
  { value: 'GV1', label: 'Variable 1' },
  { value: 'GV2', label: 'Variable 2' },
];

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── LogicPill ───────────────────────────────────────────────

interface LogicPillProps {
  value: LogicOp;
  onChange: (value: LogicOp) => void;
  first?: boolean;
}

export function LogicPill({ value, onChange, first }: LogicPillProps) {
  if (first) return null;

  return (
    <div className="flex justify-center py-0.5">
      <button
        type="button"
        onClick={() => onChange(value === 'and' ? 'or' : 'and')}
        className={`rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
          value === 'and'
            ? 'bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-400 dark:hover:bg-violet-900/60'
            : 'bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/40 dark:text-orange-400 dark:hover:bg-orange-900/60'
        }`}
        title="Click to toggle AND/OR"
      >
        {value}
      </button>
    </div>
  );
}

// ─── DevicePicker ────────────────────────────────────────────

interface DevicePickerProps {
  value: string;
  onChange: (address: string) => void;
  placeholder?: string;
  /** When true, only show devices (no scenes). Used for status checks since scenes have no status. */
  devicesOnly?: boolean;
}

/** Unified item for the device/scene picker dropdown */
interface PickerItem {
  address: string;
  name: string;
  kind: 'device' | 'scene';
}

export function DevicePicker({ value, onChange, placeholder = 'Select device...', devicesOnly = false }: DevicePickerProps) {
  const nodes = useDeviceStore((s) => s.nodes);
  const scenes = useDeviceStore((s) => s.scenes);
  const nodeMap = useDeviceStore((s) => s.nodeMap);
  const sceneMap = useDeviceStore((s) => s.sceneMap);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [open]);

  // Merge devices and scenes into a single list (optionally exclude scenes)
  const allItems: PickerItem[] = useMemo(() => {
    const items: PickerItem[] = [];
    for (const n of nodes) items.push({ address: String(n.address), name: n.name, kind: 'device' });
    if (!devicesOnly) {
      for (const s of scenes) items.push({ address: String(s.address), name: s.name, kind: 'scene' });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }, [nodes, scenes, devicesOnly]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allItems.slice(0, 50);
    const lower = search.toLowerCase();
    return allItems.filter((item) => item.name.toLowerCase().includes(lower)).slice(0, 50);
  }, [allItems, search]);

  // Resolve display name from either nodeMap or sceneMap
  const displayText = useMemo(() => {
    if (!value) return '';
    const node = nodeMap.get(value);
    if (node) return node.name;
    const scene = sceneMap.get(value);
    if (scene) return scene.name;
    return value;
  }, [value, nodeMap, sceneMap]);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) {
            setSearch('');
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }}
        className="flex w-full items-center gap-1.5 rounded border border-gray-300 bg-white px-2 py-1 text-left text-xs text-gray-900 hover:border-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-500"
      >
        <Zap size={12} className="flex-shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate">
          {displayText || <span className="text-gray-400 dark:text-gray-500">{placeholder}</span>}
        </span>
        <ChevronDown size={12} className="flex-shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center gap-2 border-b border-gray-200 px-2 py-1.5 dark:border-gray-700">
            <Search size={12} className="text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={devicesOnly ? 'Search devices...' : 'Search devices & scenes...'}
              className="flex-1 bg-transparent text-xs text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{devicesOnly ? 'No devices found' : 'No devices or scenes found'}</div>
            )}
            {filtered.map((item) => (
              <button
                key={item.address}
                type="button"
                onClick={() => {
                  onChange(item.address);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  item.address === value
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {item.kind === 'scene' && (
                  <Layers size={10} className="flex-shrink-0 text-purple-400" />
                )}
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="flex-shrink-0 text-[10px] text-gray-400">{item.address}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ProgramPicker ───────────────────────────────────────────

interface ProgramPickerProps {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}

export function ProgramPicker({ value, onChange, placeholder = 'Select program...' }: ProgramPickerProps) {
  const programs = useProgramStore((s) => s.programs);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [open]);

  // Filter out folders
  const programList = useMemo(
    () => programs.filter((p) => p['@_folder'] !== 'true' && p['@_folder'] !== true as unknown as string),
    [programs],
  );

  const selectedProgram = programList.find((p) => p['@_id'] === value);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 rounded border border-gray-300 bg-white px-2 py-1 text-left text-xs text-gray-900 hover:border-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-500"
      >
        <Play size={12} className="flex-shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate">
          {selectedProgram?.name || <span className="text-gray-400 dark:text-gray-500">{placeholder}</span>}
        </span>
        <ChevronDown size={12} className="flex-shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="max-h-72 overflow-y-auto py-1">
            {programList.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">No programs</div>
            )}
            {programList.map((prog) => (
              <button
                key={prog['@_id']}
                type="button"
                onClick={() => {
                  onChange(prog['@_id']);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  prog['@_id'] === value
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{prog.name}</span>
                <span className="flex-shrink-0 text-[10px] text-gray-400">#{prog['@_id']}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Schedule Time Picker ────────────────────────────────────

type TimeRefType = 'sunset' | 'sunrise' | 'time';

interface TimeRefValue {
  type: TimeRefType;
  offset: number; // minutes offset for sunset/sunrise; total seconds for clock time
}

function timeRefToState(ref?: { sunset?: number; sunrise?: number; time?: number }): TimeRefValue {
  if (!ref) return { type: 'sunset', offset: 0 };
  if (ref.sunset !== undefined) return { type: 'sunset', offset: ref.sunset };
  if (ref.sunrise !== undefined) return { type: 'sunrise', offset: ref.sunrise };
  if (ref.time !== undefined) return { type: 'time', offset: ref.time };
  return { type: 'sunset', offset: 0 };
}

function stateToTimeRef(val: TimeRefValue): { sunset?: number; sunrise?: number; time?: number } {
  if (val.type === 'sunset') return { sunset: val.offset };
  if (val.type === 'sunrise') return { sunrise: val.offset };
  return { time: val.offset };
}

function formatClockTime(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function parseClockTime(timeStr: string): number {
  const parts = timeStr.split(':');
  const hrs = parseInt(parts[0] ?? '0', 10) || 0;
  const mins = parseInt(parts[1] ?? '0', 10) || 0;
  return hrs * 3600 + mins * 60;
}

interface TimeRefPickerProps {
  label: string;
  value?: { sunset?: number; sunrise?: number; time?: number };
  onChange: (val: { sunset?: number; sunrise?: number; time?: number }) => void;
}

function TimeRefPicker({ label, value, onChange }: TimeRefPickerProps) {
  const state = timeRefToState(value);

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <select
          value={state.type}
          onChange={(e) => {
            const newType = e.target.value as TimeRefType;
            const newOffset = newType === 'time' ? 43200 : 0;
            onChange(stateToTimeRef({ type: newType, offset: newOffset }));
          }}
          className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="sunset">Sunset</option>
          <option value="sunrise">Sunrise</option>
          <option value="time">Time</option>
        </select>

        {state.type === 'time' ? (
          <input
            type="time"
            value={formatClockTime(state.offset)}
            onChange={(e) => onChange(stateToTimeRef({ type: 'time', offset: parseClockTime(e.target.value) }))}
            className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400">offset:</span>
            <input
              type="number"
              value={state.offset}
              onChange={(e) => onChange(stateToTimeRef({ type: state.type, offset: parseInt(e.target.value, 10) || 0 }))}
              className="w-16 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder="0"
            />
            <span className="text-[10px] text-gray-400">min</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ConditionBlockCard ──────────────────────────────────────

interface ConditionBlockCardProps {
  block: ConditionBlock;
  index: number;
  onUpdate: (block: ConditionBlock) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Depth for nested groups (0 = top level) */
  depth?: number;
}

export function ConditionBlockCard({
  block,
  index: _index,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  depth = 0,
}: ConditionBlockCardProps) {
  const cond = block.condition;

  const updateCondition = useCallback(
    (updates: Partial<ScheduleCondition> | Partial<StatusCondition> | Partial<ControlCondition> | Partial<GroupCondition>) => {
      onUpdate({
        ...block,
        condition: { ...block.condition, ...updates } as ConditionBlock['condition'],
      });
    },
    [block, onUpdate],
  );

  const typeLabel = cond.type === 'schedule' ? 'Schedule' : cond.type === 'status' ? 'Status Check' : cond.type === 'control' ? 'Control Event' : 'Group';
  const TypeIcon = cond.type === 'schedule' ? Clock : cond.type === 'status' ? Thermometer : cond.type === 'control' ? Zap : Layers;

  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800/60 dark:bg-amber-900/10 ${
        depth > 0 ? 'ml-4 border-l-2 border-l-amber-300 dark:border-l-amber-700' : ''
      }`}
    >
      {/* Header row */}
      <div className="mb-2 flex items-center gap-2">
        <TypeIcon size={14} className="flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{typeLabel}</span>

        {/* Type selector */}
        <select
          value={cond.type}
          onChange={(e) => {
            const newType = e.target.value as ConditionType;
            let newCond: ConditionBlock['condition'];
            if (newType === 'schedule') {
              newCond = { type: 'schedule', from: { sunset: 0 }, to: { sunrise: 0, nextDay: true } };
            } else if (newType === 'status') {
              newCond = { type: 'status', node: '', property: 'ST', operator: 'IS', value: '', uom: '51' };
            } else if (newType === 'control') {
              newCond = { type: 'control', node: '', event: 'DON' };
            } else {
              newCond = { type: 'group', conditions: [] };
            }
            onUpdate({ ...block, condition: newCond });
          }}
          className="ml-auto rounded border border-amber-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-700 dark:border-amber-800 dark:bg-gray-800 dark:text-gray-300"
        >
          <option value="schedule">Schedule</option>
          <option value="status">Status Check</option>
          <option value="control">Control Event</option>
          <option value="group">Group</option>
        </select>

        <div className="flex items-center gap-0.5">
          {onMoveUp && (
            <button type="button" onClick={onMoveUp} className="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Move up">
              <ChevronUp size={12} />
            </button>
          )}
          {onMoveDown && (
            <button type="button" onClick={onMoveDown} className="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Move down">
              <ChevronDown size={12} />
            </button>
          )}
          <button type="button" onClick={onRemove} className="rounded p-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400" title="Remove condition">
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Condition-specific fields */}
      {cond.type === 'schedule' && (
        <ScheduleFields
          condition={cond}
          onChange={(updates) => updateCondition(updates)}
        />
      )}

      {cond.type === 'status' && (
        <StatusFields
          condition={cond}
          onChange={(updates) => updateCondition(updates)}
        />
      )}

      {cond.type === 'control' && (
        <ControlFields
          condition={cond}
          onChange={(updates) => updateCondition(updates)}
        />
      )}

      {cond.type === 'group' && (
        <GroupFields
          condition={cond}
          onUpdate={(updatedGroup) => onUpdate({ ...block, condition: updatedGroup })}
          depth={depth}
        />
      )}
    </div>
  );
}

// ─── Schedule Fields ─────────────────────────────────────────

function ScheduleFields({ condition, onChange }: { condition: ScheduleCondition; onChange: (updates: Partial<ScheduleCondition>) => void }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <TimeRefPicker
          label="From"
          value={condition.from}
          onChange={(val) => onChange({ from: val })}
        />
        <div>
          <TimeRefPicker
            label="To"
            value={condition.to}
            onChange={(val) => onChange({ to: { ...val, nextDay: condition.to?.nextDay } })}
          />
          <label className="mt-1 flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={condition.to?.nextDay ?? false}
              onChange={(e) => onChange({ to: { ...condition.to, nextDay: e.target.checked } })}
              className="h-3 w-3 rounded border-gray-300 accent-amber-600"
            />
            Next day
          </label>
        </div>
      </div>

      {/* Days of week */}
      <div>
        <label className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Days
        </label>
        <div className="mt-1 flex flex-wrap gap-1">
          {DAYS_OF_WEEK.map((day) => {
            const selected = condition.daysOfWeek?.includes(day) ?? false;
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  const current = condition.daysOfWeek ?? [];
                  const next = selected ? current.filter((d) => d !== day) : [...current, day];
                  onChange({ daysOfWeek: next });
                }}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  selected
                    ? 'bg-amber-200 text-amber-800 dark:bg-amber-800/50 dark:text-amber-300'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Status Fields ───────────────────────────────────────────

function StatusFields({ condition, onChange }: { condition: StatusCondition; onChange: (updates: Partial<StatusCondition>) => void }) {
  return (
    <div className="space-y-2">
      <DevicePicker
        value={condition.node}
        onChange={(address) => onChange({ node: address })}
        placeholder="Pick device..."
        devicesOnly
      />
      <div className="grid grid-cols-3 gap-1.5">
        <select
          value={condition.property}
          onChange={(e) => onChange({ property: e.target.value })}
          className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          {COMMON_PROPERTIES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <select
          value={condition.operator}
          onChange={(e) => onChange({ operator: e.target.value })}
          className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          {OPERATORS.map((op) => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={condition.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="Value"
          className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-[10px] text-gray-500 dark:text-gray-400">UOM:</label>
        <input
          type="text"
          value={condition.uom}
          onChange={(e) => onChange({ uom: e.target.value })}
          placeholder="51"
          className="w-16 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>
    </div>
  );
}

// ─── Control Fields ──────────────────────────────────────────

function ControlFields({ condition, onChange }: { condition: ControlCondition; onChange: (updates: Partial<ControlCondition>) => void }) {
  return (
    <div className="space-y-2">
      <DevicePicker
        value={condition.node}
        onChange={(address) => onChange({ node: address })}
        placeholder="Pick device..."
      />
      <select
        value={condition.event}
        onChange={(e) => onChange({ event: e.target.value })}
        className="w-full rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        {CONTROL_EVENTS.map((ev) => (
          <option key={ev.value} value={ev.value}>{ev.label}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Group Fields (nested conditions) ────────────────────────

let _nextId = 1000;
function generateId(): string {
  return `block_${Date.now()}_${_nextId++}`;
}

function GroupFields({ condition, onUpdate, depth }: { condition: GroupCondition; onUpdate: (cond: GroupCondition) => void; depth: number }) {
  const addCondition = (type: ConditionType) => {
    let newCond: ConditionBlock['condition'];
    if (type === 'schedule') {
      newCond = { type: 'schedule', from: { sunset: 0 }, to: { sunrise: 0, nextDay: true } };
    } else if (type === 'status') {
      newCond = { type: 'status', node: '', property: 'ST', operator: 'IS', value: '', uom: '51' };
    } else if (type === 'control') {
      newCond = { type: 'control', node: '', event: 'DON' };
    } else {
      newCond = { type: 'group', conditions: [] };
    }
    const newBlock: ConditionBlock = {
      id: generateId(),
      logic: 'and',
      condition: newCond,
    };
    onUpdate({ ...condition, conditions: [...condition.conditions, newBlock] });
  };

  const updateChild = (index: number, updated: ConditionBlock) => {
    const next = [...condition.conditions];
    next[index] = updated;
    onUpdate({ ...condition, conditions: next });
  };

  const removeChild = (index: number) => {
    onUpdate({ ...condition, conditions: condition.conditions.filter((_, i) => i !== index) });
  };

  const moveChild = (from: number, to: number) => {
    const next = [...condition.conditions];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onUpdate({ ...condition, conditions: next });
  };

  return (
    <div className="space-y-1 rounded border border-dashed border-amber-300 p-2 dark:border-amber-700">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-500">
        Grouped Conditions (parenthesized)
      </div>
      {condition.conditions.map((child, idx) => (
        <div key={child.id}>
          <LogicPill
            value={child.logic}
            onChange={(val) => updateChild(idx, { ...child, logic: val })}
            first={idx === 0}
          />
          <ConditionBlockCard
            block={child}
            index={idx}
            onUpdate={(updated) => updateChild(idx, updated)}
            onRemove={() => removeChild(idx)}
            onMoveUp={idx > 0 ? () => moveChild(idx, idx - 1) : undefined}
            onMoveDown={idx < condition.conditions.length - 1 ? () => moveChild(idx, idx + 1) : undefined}
            depth={depth + 1}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => addCondition('status')}
        className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-amber-300 py-1.5 text-[10px] font-medium text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-500 dark:hover:bg-amber-900/20"
      >
        + Add to Group
      </button>
    </div>
  );
}

// ─── ActionBlockCard ─────────────────────────────────────────

interface ActionBlockCardProps {
  block: ActionBlock;
  index: number;
  color: 'green' | 'blue';
  onUpdate: (block: ActionBlock) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function ActionBlockCard({
  block,
  index: _index,
  color,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: ActionBlockCardProps) {
  const borderColor = color === 'green'
    ? 'border-green-200 bg-green-50/50 dark:border-green-800/60 dark:bg-green-900/10'
    : 'border-blue-200 bg-blue-50/50 dark:border-blue-800/60 dark:bg-blue-900/10';

  const accentColor = color === 'green'
    ? 'text-green-700 dark:text-green-400'
    : 'text-blue-700 dark:text-blue-400';

  const actionLabels: Record<ActionType, string> = {
    cmd: 'Device Command',
    wait: 'Wait',
    runthen: 'Run Then',
    runelse: 'Run Else',
    runif: 'Run If',
    enable: 'Enable Program',
    disable: 'Disable Program',
    notify: 'Send Notification',
  };

  const ActionIcon = block.action === 'cmd' ? Power
    : block.action === 'wait' ? Clock
    : block.action === 'notify' ? Bell
    : block.action === 'enable' || block.action === 'disable' ? Pause
    : Play;

  return (
    <div className={`rounded-lg border p-3 ${borderColor}`}>
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <ActionIcon size={14} className={`flex-shrink-0 ${accentColor}`} />
        <span className={`text-xs font-semibold ${accentColor}`}>{actionLabels[block.action]}</span>

        <select
          value={block.action}
          onChange={(e) => {
            const newAction = e.target.value as ActionType;
            const updated: ActionBlock = {
              id: block.id,
              action: newAction,
              node: newAction === 'cmd' ? block.node ?? '' : undefined,
              command: newAction === 'cmd' ? block.command ?? 'DON' : undefined,
              value: newAction === 'cmd' ? block.value : undefined,
              uom: newAction === 'cmd' ? block.uom ?? '51' : undefined,
              hours: newAction === 'wait' ? block.hours ?? 0 : undefined,
              minutes: newAction === 'wait' ? block.minutes ?? 0 : undefined,
              seconds: newAction === 'wait' ? block.seconds ?? 0 : undefined,
              programId: ['runthen', 'runelse', 'runif', 'enable', 'disable'].includes(newAction) ? block.programId ?? '' : undefined,
              notifyContent: newAction === 'notify' ? block.notifyContent ?? '' : undefined,
              notifyChannel: newAction === 'notify' ? block.notifyChannel ?? '1' : undefined,
            };
            onUpdate(updated);
          }}
          className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] text-gray-700 dark:text-gray-300 ${
            color === 'green'
              ? 'border-green-200 bg-white dark:border-green-800 dark:bg-gray-800'
              : 'border-blue-200 bg-white dark:border-blue-800 dark:bg-gray-800'
          }`}
        >
          <option value="cmd">Device Command</option>
          <option value="wait">Wait</option>
          <option value="runthen">Run Then</option>
          <option value="runelse">Run Else</option>
          <option value="runif">Run If</option>
          <option value="enable">Enable Program</option>
          <option value="disable">Disable Program</option>
          <option value="notify">Notification</option>
        </select>

        <div className="flex items-center gap-0.5">
          {onMoveUp && (
            <button type="button" onClick={onMoveUp} className="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Move up">
              <ChevronUp size={12} />
            </button>
          )}
          {onMoveDown && (
            <button type="button" onClick={onMoveDown} className="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Move down">
              <ChevronDown size={12} />
            </button>
          )}
          <button type="button" onClick={onRemove} className="rounded p-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400" title="Remove action">
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Action-specific fields */}
      {block.action === 'cmd' && (
        <CmdActionFields block={block} onUpdate={onUpdate} />
      )}
      {block.action === 'wait' && (
        <WaitActionFields block={block} onUpdate={onUpdate} />
      )}
      {(block.action === 'runthen' || block.action === 'runelse' || block.action === 'runif' || block.action === 'enable' || block.action === 'disable') && (
        <ProgramActionFields block={block} onUpdate={onUpdate} />
      )}
      {block.action === 'notify' && (
        <NotifyActionFields block={block} onUpdate={onUpdate} />
      )}
    </div>
  );
}

// ─── Action Field Components ─────────────────────────────────

/** Commands that accept an optional value parameter (brightness level, etc.) */
const COMMANDS_WITH_VALUE = new Set(['DON', 'BRT', 'DIM']);

function CmdActionFields({ block, onUpdate }: { block: ActionBlock; onUpdate: (b: ActionBlock) => void }) {
  const showValue = COMMANDS_WITH_VALUE.has(block.command ?? '');

  return (
    <div className="space-y-2">
      <DevicePicker
        value={block.node ?? ''}
        onChange={(address) => onUpdate({ ...block, node: address })}
        placeholder="Pick device or scene..."
      />
      <div className={`grid gap-1.5 ${showValue ? 'grid-cols-3' : 'grid-cols-1'}`}>
        <select
          value={block.command ?? 'DON'}
          onChange={(e) => {
            const cmd = e.target.value;
            // Clear value/uom when switching to a command that doesn't accept them
            if (!COMMANDS_WITH_VALUE.has(cmd)) {
              onUpdate({ ...block, command: cmd, value: '', uom: '' });
            } else {
              onUpdate({ ...block, command: cmd });
            }
          }}
          className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          {DEVICE_COMMANDS.map((cmd) => (
            <option key={cmd.value} value={cmd.value}>{cmd.label}</option>
          ))}
        </select>
        {showValue && (
          <>
            <input
              type="text"
              value={block.value ?? ''}
              onChange={(e) => onUpdate({ ...block, value: e.target.value })}
              placeholder="Value (opt)"
              className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
            <input
              type="text"
              value={block.uom ?? '51'}
              onChange={(e) => onUpdate({ ...block, uom: e.target.value })}
              placeholder="UOM"
              className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </>
        )}
      </div>
    </div>
  );
}

function WaitActionFields({ block, onUpdate }: { block: ActionBlock; onUpdate: (b: ActionBlock) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={block.hours ?? 0}
          onChange={(e) => onUpdate({ ...block, hours: parseInt(e.target.value, 10) || 0 })}
          className="w-14 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <span className="text-[10px] text-gray-500 dark:text-gray-400">hr</span>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={59}
          value={block.minutes ?? 0}
          onChange={(e) => onUpdate({ ...block, minutes: parseInt(e.target.value, 10) || 0 })}
          className="w-14 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <span className="text-[10px] text-gray-500 dark:text-gray-400">min</span>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={59}
          value={block.seconds ?? 0}
          onChange={(e) => onUpdate({ ...block, seconds: parseInt(e.target.value, 10) || 0 })}
          className="w-14 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <span className="text-[10px] text-gray-500 dark:text-gray-400">sec</span>
      </div>
    </div>
  );
}

function ProgramActionFields({ block, onUpdate }: { block: ActionBlock; onUpdate: (b: ActionBlock) => void }) {
  return (
    <ProgramPicker
      value={block.programId ?? ''}
      onChange={(id) => onUpdate({ ...block, programId: id })}
      placeholder="Select target program..."
    />
  );
}

function NotifyActionFields({ block, onUpdate }: { block: ActionBlock; onUpdate: (b: ActionBlock) => void }) {
  return (
    <div className="space-y-2">
      <input
        type="text"
        value={block.notifyContent ?? ''}
        onChange={(e) => onUpdate({ ...block, notifyContent: e.target.value })}
        placeholder="Content ID"
        className="w-full rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
      />
      <input
        type="text"
        value={block.notifyChannel ?? '1'}
        onChange={(e) => onUpdate({ ...block, notifyChannel: e.target.value })}
        placeholder="Channel"
        className="w-full rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
      />
    </div>
  );
}

// Re-export the generateId utility for ProgramEditor
export { generateId };
