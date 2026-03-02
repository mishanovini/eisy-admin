/**
 * Program detail panel — shows program info, IF/THEN/ELSE definitions,
 * and run/stop/enable/disable controls.
 */
import { useState } from 'react';
import {
  Play,
  Square,
  ToggleLeft,
  ToggleRight,
  Clock,
  Code2,
  RefreshCw,
  Pencil,
} from 'lucide-react';
import { useProgramStore } from '@/stores/program-store.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { boolAttr } from '@/utils/xml-parser.ts';
import {
  runProgram,
  runProgramElse,
  stopProgram,
  enableProgram,
  disableProgram,
} from '@/api/rest.ts';
import { useLogStore } from '@/stores/log-store.ts';
import { ConfirmDialog } from '@/components/common/ConfirmDialog.tsx';
import { useConfirm } from '@/hooks/useConfirm.ts';

interface ProgramDetailProps {
  id: string;
  onEdit?: () => void;
}

export function ProgramDetail({ id, onEdit }: ProgramDetailProps) {
  const program = useProgramStore((s) => s.getProgram(id));
  const trigger = useProgramStore((s) => s.getTrigger(parseInt(id, 16)));
  const nodeMap = useDeviceStore((s) => s.nodeMap);
  const sceneMap = useDeviceStore((s) => s.sceneMap);
  const programs = useProgramStore((s) => s.programs);
  const triggers = useProgramStore((s) => s.triggers);
  const [pending, setPending] = useState(false);
  const [confirmProps, confirm] = useConfirm();

  if (!program) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400 dark:text-gray-500">Program not found.</p>
      </div>
    );
  }

  const isFolder = boolAttr(program['@_folder']);
  const enabled = boolAttr(program['@_enabled']);
  const running = program['@_running'] === 'running' || program['@_running'] === 'then' || program['@_running'] === 'else';

  if (isFolder) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-900/20">
            <Code2 size={24} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {program.name}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Program Folder</p>
          </div>
        </div>
      </div>
    );
  }

  const exec = async (action: () => Promise<boolean>, actionLabel: string) => {
    setPending(true);
    try {
      const ok = await action();
      // Log program action to the event log
      useLogStore.getState().addEntry({
        category: 'program',
        device: id,
        deviceName: program.name,
        action: actionLabel,
        source: 'manual',
        result: ok ? 'success' : 'fail',
      });
      // Refresh program store after action
      setTimeout(() => useProgramStore.getState().fetchPrograms(), 500);
    } finally {
      setPending(false);
    }
  };

  // Build a name resolver that covers nodes, scenes, and programs
  const resolver = buildNameResolver(nodeMap, sceneMap, programs, triggers);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-900/20">
          <Code2 size={24} className="text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {program.name}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Program &middot; ID {program['@_id']}
            {running && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                <Play size={10} /> Running
              </span>
            )}
            {!enabled && (
              <span className="ml-2 text-xs text-gray-400">Disabled</span>
            )}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => exec(() => runProgram(id), 'Run Then')}
          disabled={pending}
          className="flex items-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          <Play size={14} /> Run Then
        </button>
        <button
          onClick={() => exec(() => runProgramElse(id), 'Run Else')}
          disabled={pending}
          className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Play size={14} /> Run Else
        </button>
        {running && (
          <button
            onClick={() => exec(() => stopProgram(id), 'Stop')}
            disabled={pending}
            className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Square size={14} /> Stop
          </button>
        )}
        <button
          onClick={async () => {
            if (enabled) {
              const ok = await confirm({
                title: 'Disable Program?',
                message: `"${program.name}" will stop running and won't trigger until re-enabled.`,
                confirmLabel: 'Disable',
                variant: 'warning',
              });
              if (!ok) return;
            }
            exec(enabled ? () => disableProgram(id) : () => enableProgram(id), enabled ? 'Disable' : 'Enable');
          }}
          disabled={pending}
          className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
          {enabled ? 'Disable' : 'Enable'}
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Pencil size={14} /> Edit
          </button>
        )}
      </div>

      {/* Run times */}
      <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          <Clock size={14} /> Timing
        </h3>
        <dl className="space-y-1 text-sm">
          <div className="flex">
            <dt className="w-32 text-gray-500 dark:text-gray-400">Last Run</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {program.lastRunTime?.trim() || 'Never'}
            </dd>
          </div>
          <div className="flex">
            <dt className="w-32 text-gray-500 dark:text-gray-400">Last Finished</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {program.lastFinishTime?.trim() || 'Never'}
            </dd>
          </div>
          {program.nextScheduledRunTime && (
            <div className="flex">
              <dt className="w-32 text-gray-500 dark:text-gray-400">Next Run</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {program.nextScheduledRunTime}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* IF / THEN / ELSE from D2D */}
      {trigger && (
        <div className="space-y-3">
          {trigger.if && (
            <ProgramBlock label="IF" content={trigger.if} resolver={resolver} color="amber" />
          )}
          {trigger.then && (
            <ProgramBlock label="THEN" content={trigger.then} resolver={resolver} color="green" />
          )}
          {trigger.else && (
            <ProgramBlock label="ELSE" content={trigger.else} resolver={resolver} color="blue" />
          )}
          {trigger.comment && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Comment: </span>
              <span className="text-sm text-gray-700 dark:text-gray-300">{trigger.comment}</span>
            </div>
          )}
        </div>
      )}

      {!trigger && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center dark:border-gray-700 dark:bg-gray-800/50">
          <p className="text-sm text-gray-400 dark:text-gray-500">
            D2D program logic not loaded. Click refresh to load full definitions.
          </p>
          <button
            onClick={() => useProgramStore.getState().fetchD2D()}
            className="mt-2 flex items-center gap-1 rounded bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            <RefreshCw size={12} /> Load D2D
          </button>
        </div>
      )}

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}

// ─── Name Resolution ─────────────────────────────────────────

type NameResolver = (raw: string) => string;

/**
 * Build a unified name resolver that maps device addresses, scene addresses,
 * and program IDs to human-readable names. Handles multiple address formats.
 */
function buildNameResolver(
  nodeMap: Map<string, { name: string }>,
  sceneMap: Map<string, { name: string }>,
  programs: { '@_id': string; name: string }[],
  triggers: { id: number; name: string }[],
): NameResolver {
  // Program lookup by decimal ID
  const programMap = new Map<string, string>();
  for (const p of programs) {
    programMap.set(p['@_id'], p.name);
    // D2D uses decimal program IDs
    const dec = parseInt(p['@_id'], 16);
    if (!isNaN(dec)) programMap.set(String(dec), p.name);
  }
  for (const t of triggers) {
    if (t.name) programMap.set(String(t.id), t.name);
  }

  // Build a compact (no-space) lookup for fuzzy address matching
  // NOTE: fast-xml-parser may coerce numeric-looking addresses to numbers,
  // so always String() the key to be safe.
  const compactMap = new Map<string, string>();
  for (const [addr, node] of nodeMap) {
    const addrStr = String(addr);
    compactMap.set(addrStr.replace(/\s+/g, ''), node.name);
  }
  for (const [addr, scene] of sceneMap) {
    const addrStr = String(addr);
    compactMap.set(addrStr.replace(/\s+/g, ''), scene.name);
  }

  // Build a prefix lookup: "56 38 6" should match "56 38 6 1"
  const prefixMap = new Map<string, string>();
  for (const [addr, node] of nodeMap) {
    const addrStr = String(addr);
    // Remove trailing subdevice number: "56 38 6 1" → "56 38 6"
    const parts = addrStr.split(/\s+/);
    if (parts.length > 1) {
      const prefix = parts.slice(0, -1).join(' ');
      prefixMap.set(prefix, node.name);
      prefixMap.set(prefix.replace(/\s+/g, ''), node.name);
    }
  }

  return (raw: string): string => {
    if (!raw) return '?';
    const trimmed = String(raw).trim();

    // Direct nodeMap match (try both string and number keys due to parser coercion)
    if (nodeMap.has(trimmed)) return nodeMap.get(trimmed)!.name;
    if (nodeMap.has(trimmed as never)) return (nodeMap as Map<unknown, { name: string }>).get(trimmed)?.name ?? '';

    // Direct sceneMap match
    if (sceneMap.has(trimmed)) return sceneMap.get(trimmed)!.name;

    // Program ID match
    if (programMap.has(trimmed)) return `"${programMap.get(trimmed)!}"`;

    // Compact (no-space) match against nodes and scenes
    const compact = trimmed.replace(/\s+/g, '');
    if (compactMap.has(compact)) return compactMap.get(compact)!;

    // Prefix match (address without subdevice number)
    if (prefixMap.has(trimmed)) return prefixMap.get(trimmed)!;
    if (prefixMap.has(compact)) return prefixMap.get(compact)!;

    // Try numeric coercion: D2D might use "56386" while map has numeric 56386
    const asNum = Number(trimmed);
    if (!isNaN(asNum)) {
      for (const [addr, node] of nodeMap) {
        if (Number(addr) === asNum || String(addr) === trimmed) return node.name;
      }
      for (const [addr, scene] of sceneMap) {
        if (Number(addr) === asNum || String(addr) === trimmed) return scene.name;
      }
    }

    // Clean and return as-is
    return trimmed.replace(/^"|"$/g, '');
  };
}

// ─── Program Block Rendering ─────────────────────────────────

function ProgramBlock({
  label,
  content,
  resolver,
  color,
}: {
  label: string;
  content: string;
  resolver: NameResolver;
  color: 'amber' | 'green' | 'blue';
}) {
  const colorClasses = {
    amber: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10',
    green: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/10',
    blue: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/10',
  };

  const labelClasses = {
    amber: 'text-amber-700 dark:text-amber-400',
    green: 'text-green-700 dark:text-green-400',
    blue: 'text-blue-700 dark:text-blue-400',
  };

  const humanReadable = humanizeD2DBlock(content, resolver);

  return (
    <div className={`rounded-lg border p-3 ${colorClasses[color]}`}>
      <div className={`mb-1 text-xs font-bold uppercase tracking-wider ${labelClasses[color]}`}>
        {label}
      </div>
      <div className="space-y-0.5 font-mono text-xs text-gray-800 dark:text-gray-200">
        {humanReadable.map((line, i) => (
          <div key={i} style={{ paddingLeft: `${line.indent * 16}px` }}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── D2D XML Humanizer ───────────────────────────────────────

interface HumanLine {
  text: string;
  indent: number;
}

/** D2D command ID → human-readable verb mapping */
const CMD_NAMES: Record<string, string> = {
  DON: 'On', DOF: 'Off', DFON: 'Fast On', DFOF: 'Fast Off',
  BRT: 'Brighten', DIM: 'Dim', QUERY: 'Query', BEEP: 'Beep',
  CLIMD: 'Climate Mode', CLISPH: 'Heat Setpoint', CLISPC: 'Cool Setpoint',
  CLIFS: 'Fan State', SECMD: 'Security', LOCK: 'Lock', UNLOCK: 'Unlock',
  OL: 'On Level', RR: 'Ramp Rate', ST: 'Status',
  BATLVL: 'Battery Level', BATLVL2: 'Battery Level',
  LUTEFLAG: 'Lutron Flag', CLIHUM: 'Humidity',
  FDUP: 'Fan Up', FDDOWN: 'Fan Down', FDSTOP: 'Fan Stop',
  GV1: 'Variable 1', GV2: 'Variable 2',
};

/** D2D operator → readable comparison */
const OP_NAMES: Record<string, string> = {
  IS: 'is', NOT: 'is not', GT: '>', LT: '<', GTE: '≥', LTE: '≤',
};

/** UOM ID → unit suffix */
function getUomSuffix(uom: string | undefined): string {
  if (!uom) return '';
  const map: Record<string, string> = {
    '51': '%', '17': '°F', '4': '°C', '58': 's', '57': 'min',
    '2': 'A', '73': 'V', '33': 'Hz', '1': 'A',
  };
  return map[uom] ?? '';
}

/**
 * Convert raw value + UOM into display value.
 *
 * In D2D XML, the encoding differs between conditions and actions:
 * - STATUS CONDITIONS: UOM 51 values are the displayed percentage (0-100).
 *   A fan "on" = 100, battery 25% = 25, dimmer 50% = 50.
 * - CMD ACTIONS: UOM 51 values use 0-255 byte scale. 255 = 100%, 0 = 0%.
 *
 * The `context` parameter controls which interpretation is used:
 * - 'condition' (default): treat value as direct percentage
 * - 'action': apply 0-255 → 0-100% scaling
 */
type ValueContext = 'condition' | 'action';

function formatValue(rawVal: string, uom: string | undefined, _propId?: string, context: ValueContext = 'condition'): string {
  if (!rawVal) return '';
  const num = parseInt(rawVal, 10);

  if (uom === '51') {
    if (context === 'action') {
      // Command values use 0-255 byte scale
      if (num === 255) return '100%';
      if (num === 0) return '0%';
      return `${Math.round((num / 255) * 100)}%`;
    }
    // Condition values are already percentages (0-100)
    return `${num}%`;
  }
  if (uom === '100') {
    // UOM 100 = byte — always 0-255 → 0-100%
    if (num === 255) return '100%';
    if (num === 0) return '0%';
    return `${Math.round((num / 255) * 100)}%`;
  }
  return `${rawVal}${getUomSuffix(uom)}`;
}

/** Parse a schedule time reference (sunrise, sunset, or clock time) */
function parseTimeRef(xml: string): string {
  if (/<sunset>/.test(xml)) {
    const offset = xml.match(/<sunset>(-?\d+)<\/sunset>/)?.[1];
    const mins = offset ? parseInt(offset, 10) : 0;
    if (mins === 0) return 'Sunset';
    return mins > 0 ? `Sunset + ${mins}min` : `Sunset - ${Math.abs(mins)}min`;
  }
  if (/<sunrise>/.test(xml)) {
    const offset = xml.match(/<sunrise>(-?\d+)<\/sunrise>/)?.[1];
    const mins = offset ? parseInt(offset, 10) : 0;
    if (mins === 0) return 'Sunrise';
    return mins > 0 ? `Sunrise + ${mins}min` : `Sunrise - ${Math.abs(mins)}min`;
  }
  const timeMatch = xml.match(/<time>(\d+)<\/time>/);
  if (timeMatch) {
    const secs = parseInt(timeMatch[1]!, 10);
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const ampm = hrs >= 12 ? 'PM' : 'AM';
    const h12 = hrs === 0 ? 12 : hrs > 12 ? hrs - 12 : hrs;
    return `${h12}:${mins.toString().padStart(2, '0')} ${ampm}`;
  }
  return xml.replace(/<[^>]+>/g, '').trim() || '?';
}

/** Humanize a <schedule> block */
function humanizeSchedule(inner: string): string {
  const fromMatch = inner.match(/<from>([\s\S]*?)<\/from>/);
  const toMatch = inner.match(/<to>([\s\S]*?)<\/to>/);
  const atMatch = inner.match(/<at>([\s\S]*?)<\/at>/);

  // Days of week
  const dowMatch = inner.match(/<daysofweek>([\s\S]*?)<\/daysofweek>/);
  let dowStr = '';
  if (dowMatch) {
    const days: string[] = [];
    if (/<mon\s*\/?>/.test(dowMatch[1]!)) days.push('Mon');
    if (/<tue\s*\/?>/.test(dowMatch[1]!)) days.push('Tue');
    if (/<wed\s*\/?>/.test(dowMatch[1]!)) days.push('Wed');
    if (/<thu\s*\/?>/.test(dowMatch[1]!)) days.push('Thu');
    if (/<fri\s*\/?>/.test(dowMatch[1]!)) days.push('Fri');
    if (/<sat\s*\/?>/.test(dowMatch[1]!)) days.push('Sat');
    if (/<sun\s*\/?>/.test(dowMatch[1]!)) days.push('Sun');
    dowStr = days.length === 7 ? 'Every day' : days.join(', ');
  }

  if (fromMatch && toMatch) {
    const from = parseTimeRef(fromMatch[1]!);
    const to = parseTimeRef(toMatch[1]!);
    const dayMatch = toMatch[1]!.match(/<day>(\d+)<\/day>/);
    const nextDay = dayMatch && dayMatch[1] === '1' ? ' (next day)' : '';
    const prefix = dowStr ? `${dowStr}: ` : '';
    return `${prefix}From ${from} To ${to}${nextDay}`;
  }

  if (atMatch) {
    const time = parseTimeRef(atMatch[1]!);
    const prefix = dowStr ? `${dowStr}: ` : '';
    return `${prefix}At ${time}`;
  }

  if (dowStr) return dowStr;
  return 'Schedule';
}

/** Humanize a <wait> block */
function humanizeWait(inner: string): string {
  const hours = inner.match(/<hours>(\d+)<\/hours>/)?.[1];
  const minutes = inner.match(/<minutes>(\d+)<\/minutes>/)?.[1];
  const seconds = inner.match(/<seconds>(\d+)<\/seconds>/)?.[1];

  const parts: string[] = [];
  if (hours && hours !== '0') parts.push(`${hours} hour${hours === '1' ? '' : 's'}`);
  if (minutes && minutes !== '0') parts.push(`${minutes} minute${minutes === '1' ? '' : 's'}`);
  if (seconds && seconds !== '0') parts.push(`${seconds} second${seconds === '1' ? '' : 's'}`);

  return `Wait ${parts.join(' ') || '0 seconds'}`;
}

/** Humanize a <status> condition */
function humanizeStatus(attrs: Record<string, string>, inner: string, resolver: NameResolver): string {
  const propId = attrs.id ?? '';
  const prop = CMD_NAMES[propId] ?? (propId || 'Status');
  const node = attrs.node ? resolver(attrs.node) : '';
  const op = OP_NAMES[attrs.op ?? ''] ?? attrs.op ?? '';

  const valMatch = inner.match(/<val[^>]*>([^<]*)<\/val>/);
  const uomMatch = inner.match(/uom="(\d+)"/);
  const val = valMatch?.[1] ? formatValue(valMatch[1], uomMatch?.[1], propId) : '';

  return `${node} ${prop} ${op} ${val}`.replace(/\s+/g, ' ').trim();
}

/** Humanize a <cmd> action */
function humanizeCmd(attrs: Record<string, string>, inner: string, resolver: NameResolver): string {
  const cmdId = attrs.id ?? '';
  const cmd = CMD_NAMES[cmdId] ?? (cmdId || '?');
  const node = attrs.node ? resolver(attrs.node) : '';

  let valStr = '';
  if (inner) {
    const valMatch = inner.match(/<val[^>]*>([^<]*)<\/val>/);
    const uomMatch = inner.match(/uom="(\d+)"/);
    if (valMatch?.[1]) {
      valStr = ` ${formatValue(valMatch[1], uomMatch?.[1], cmdId, 'action')}`;
    }
  }

  return `Set ${node} → ${cmd}${valStr}`.trim();
}

/** Control-event labels: in <control> context, GV1/GV2 mean Pressed/Held (IR buttons) */
const CONTROL_EVENT_NAMES: Record<string, string> = {
  DON: 'On', DOF: 'Off', DFON: 'Fast On', DFOF: 'Fast Off',
  GV1: 'Pressed', GV2: 'Held',
};

/** Humanize a <control> condition */
function humanizeControl(attrs: Record<string, string>, resolver: NameResolver): string {
  const node = attrs.node ? resolver(attrs.node) : '';
  const eventName = CONTROL_EVENT_NAMES[attrs.id ?? ''];

  // Format like the UDAC: "Device Name is switched On/Off/Pressed/Held"
  if (eventName) return `${node} is switched ${eventName}`;

  const cmd = CMD_NAMES[attrs.id ?? ''] ?? attrs.id ?? '?';
  const op = OP_NAMES[attrs.op ?? ''] ?? attrs.op ?? '';
  return `${node} ${cmd} ${op}`.replace(/\s+/g, ' ').trim();
}

/**
 * Parse D2D XML block into human-readable lines.
 *
 * Strategy: First extract multi-tag constructs (schedule, wait, cmd, status)
 * using regex and replace with inline markers. Then parse remaining single tags
 * (and, or, paren, control) with the token-based approach.
 */
function humanizeD2DBlock(xml: string, resolver: NameResolver, notificationMap: Map<string, string> = new Map()): HumanLine[] {
  // Clean the XML
  let processed = xml
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');

  // Pre-extract multi-tag blocks → replace with self-closing marker tags
  let markerIdx = 0;
  const markers = new Map<string, string>();

  function addMarker(text: string): string {
    const id = `_M${markerIdx++}_`;
    markers.set(id, text);
    return `<${id} />`;
  }

  // 1. Schedules: <schedule>...</schedule>
  processed = processed.replace(/<schedule>([\s\S]*?)<\/schedule>/g, (_, inner: string) =>
    addMarker(humanizeSchedule(inner)),
  );

  // 2. Wait blocks: <wait>...</wait>
  processed = processed.replace(/<wait>([\s\S]*?)<\/wait>/g, (_, inner: string) =>
    addMarker(humanizeWait(inner)),
  );

  // 3. Status conditions: <status ...>...</status>
  processed = processed.replace(/<status([^>]*)>([\s\S]*?)<\/status>/g, (_, attrStr: string, inner: string) =>
    addMarker(humanizeStatus(parseAttrs(`<status${attrStr}>`), inner, resolver)),
  );

  // 4. Cmd actions (with children): <cmd ...>...</cmd>
  processed = processed.replace(/<cmd([^/]*?)>([\s\S]*?)<\/cmd>/g, (_, attrStr: string, inner: string) =>
    addMarker(humanizeCmd(parseAttrs(`<cmd${attrStr}>`), inner, resolver)),
  );

  // 5. Self-closing cmd: <cmd ... />
  processed = processed.replace(/<cmd([^>]*?)\/>/g, (_, attrStr: string) =>
    addMarker(humanizeCmd(parseAttrs(`<cmd${attrStr}/>`), '', resolver)),
  );

  // 6. Self-closing control: <control ... />
  processed = processed.replace(/<control([^>]*?)\/>/g, (_, attrStr: string) =>
    addMarker(humanizeControl(parseAttrs(`<control${attrStr}/>`), resolver)),
  );

  // 7. Non-self-closing control: <control ...></control>
  processed = processed.replace(/<control([^>]*)>[^<]*<\/control>/g, (_, attrStr: string) =>
    addMarker(humanizeControl(parseAttrs(`<control${attrStr}>`), resolver)),
  );

  // 8. Program cross-references
  const progTags: Record<string, string> = {
    runthen: 'Run Then', runelse: 'Run Else', runif: 'Run If',
    enable: 'Enable', disable: 'Disable',
  };
  for (const [tag, label] of Object.entries(progTags)) {
    processed = processed.replace(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'), (_, inner: string) => {
      const id = inner.trim();
      const name = resolver(id);
      return addMarker(`${label}: ${name}`);
    });
  }

  // 9. Notify — extract content/channel IDs and show name if available
  processed = processed.replace(/<notify\s*([^>]*)>([^<]*)<\/notify>/g, (_match, attrStr: string, channelId: string) => {
    const contentMatch = attrStr.match(/content="([^"]*)"/);
    const contentId = contentMatch?.[1] ?? '';
    const channel = channelId.trim();
    // Try to resolve notification name from the notificationMap
    const notifyName = notificationMap.get(channel) ?? notificationMap.get(contentId);
    if (notifyName) {
      return addMarker(`Send Notification to '${notifyName}'`);
    }
    // Fallback: show IDs if available
    if (channel || contentId) {
      return addMarker(`Send Notification (channel ${channel || contentId})`);
    }
    return addMarker('Send notification');
  });

  // 10. Device/net commands (less common)
  processed = processed.replace(/<device>[\s\S]*?<\/device>/g, () =>
    addMarker('Query all devices'),
  );
  processed = processed.replace(/<net>[\s\S]*?<\/net>/g, () =>
    addMarker('Network resource command'),
  );

  // Now parse remaining tokens (conjunctions, grouping, markers)
  const tokens = processed.match(/<[^>]+\/?>/g) || [];
  const lines: HumanLine[] = [];
  let indent = 0;

  for (const token of tokens) {
    // Closing tags
    if (/^<\//.test(token)) {
      const tagName = token.match(/<\/(\w+)/)?.[1] ?? '';
      if (tagName === 'paren') {
        indent = Math.max(0, indent - 1);
        lines.push({ text: ')', indent });
      } else if (tagName === 'if' || tagName === 'then' || tagName === 'else') {
        indent = Math.max(0, indent - 1);
      }
      continue;
    }

    const tagName = token.match(/<(\w+)/)?.[1] ?? '';

    // Check for our markers
    if (tagName.startsWith('_M') && markers.has(tagName)) {
      lines.push({ text: markers.get(tagName)!, indent });
      continue;
    }

    if (tagName === 'and') {
      lines.push({ text: 'AND', indent });
    } else if (tagName === 'or') {
      lines.push({ text: 'OR', indent });
    } else if (tagName === 'not') {
      lines.push({ text: 'NOT', indent });
    } else if (tagName === 'paren') {
      lines.push({ text: '(', indent });
      indent++;
    } else if (tagName === 'if' || tagName === 'then' || tagName === 'else') {
      // Section markers — skip, labeled by the UI
    }
    // Other unknown tags are silently skipped
  }

  // Fallback
  if (lines.length === 0) {
    const cleaned = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    lines.push({ text: cleaned.substring(0, 500) || '(empty)', indent: 0 });
  }

  return lines;
}

/** Extract attributes from an XML tag string */
function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    if (m[1] !== undefined) attrs[m[1]] = m[2] ?? '';
  }
  return attrs;
}
