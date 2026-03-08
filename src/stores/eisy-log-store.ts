/**
 * eisy Event Log — fetches the eisy's native event log via /rest/log
 * and provides two output streams:
 *
 * 1. **Live feed** (in-memory ring buffer, `liveEntries`):
 *    ALL parsed events including status updates. Displayed on the eisy tab
 *    as a real-time event viewer. Not persisted — only while the page is open.
 *
 * 2. **Operational events** (persisted to IndexedDB via log-store):
 *    Only meaningful operational events: link table writes, scene operations,
 *    PLM operations, memory writes, errors. Excluded from "All" tab noise.
 *    Status updates (ST/DON/DOF) are NOT persisted — the WebSocket already
 *    logs those as 'comms' entries with proper device names.
 *
 * The eisy's /rest/log endpoint returns the entire event buffer each call.
 * Format per line: "<addr> <ctrl> <val> <subnode> <day> <date> <time> <type> <level>"
 * e.g.: "56 1C 5F 1 ST On Tue 2026/02/03 17:45:46 0 5"
 *
 * Architecture:
 * - On app connect: init() sets debug level + fetches full buffer, parses into
 *   liveEntries (all) and persists operational events to IndexedDB
 * - While Logs page eisy tab is open: polls every 5s for new lines
 * - When Logs page unmounts: polling stops
 *
 * Log levels (matching UDAC Event Viewer):
 *   0 = None, 1 = Status/Operational, 2 = More Info, 3 = Device Communications
 */
import { create } from 'zustand';
import { fetchEventLog, resetEventLog } from '@/api/rest.ts';
import { setDebugLevel } from '@/api/soap.ts';
import { useLogStore } from '@/stores/log-store.ts';
import { useDeviceStore } from '@/stores/device-store.ts';

export type EisyLogLevel = 0 | 1 | 2 | 3;

const POLL_INTERVAL = 5_000;
const MAX_LIVE_ENTRIES = 500;

// ─── Live entry type (in-memory only, richer than LogEntry) ──

export interface EisyLiveEntry {
  /** Incrementing ID for React keys */
  id: number;
  /** Device address (display format, e.g., "56.28.D7") */
  device?: string;
  /** Human-readable device name */
  deviceName?: string;
  /** Control code (ST, DON, DOF, etc.) */
  control?: string;
  /** Value (On, Off, 40%, etc.) */
  value?: string;
  /** Human-readable action description */
  action: string;
  /** Operation category for the line */
  detail?: string;
  /** Whether this is a status-only event (vs operational) */
  isStatus: boolean;
  /** Timestamp string from the eisy log, or current time */
  timestamp: string;
  /** Raw log line for debugging */
  raw: string;
}

let liveIdCounter = 0;

// ─── Store interface ─────────────────────────────────────────

interface EisyLogState {
  /** Whether we've initialized (debug level set, buffer fetched) */
  initialized: boolean;
  /** Whether the poller is actively running (eisy tab open) */
  polling: boolean;
  /** Current debug level on the eisy */
  level: EisyLogLevel;
  /** Number of operational events persisted to IndexedDB this session */
  persistedCount: number;
  /** Last error from polling */
  lastError: string | null;
  /** In-memory ring buffer of ALL parsed events (for live eisy tab) */
  liveEntries: EisyLiveEntry[];

  /** One-time init: set debug level + fetch full buffer. Called from AppShell. */
  init: (level?: EisyLogLevel) => Promise<void>;
  /** Start continuous polling. Called when eisy tab is active. */
  startPolling: () => void;
  /** Stop continuous polling. Called when eisy tab unmounts. */
  stopPolling: () => void;
  /** Change the debug level on the eisy */
  setLevel: (level: EisyLogLevel) => Promise<void>;
  /** Reset/clear the eisy's event log buffer */
  reset: () => Promise<void>;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * How many lines we've seen so far. init() fetches the full buffer and sets
 * this to the initial count; subsequent polls only grab lines beyond this mark.
 */
let lastLineCount = 0;

// ─── Parsing ────────────────────────────────────────────────

/**
 * Extract text content from the eisy's /rest/log response.
 * May be XML-wrapped, CDATA-wrapped, or plain text.
 */
function extractText(raw: string): string {
  if (!raw || !raw.trim()) return '';

  let text = raw;

  // Try CDATA
  const cdataMatch = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdataMatch) return cdataMatch[1]!;

  // Try <log> wrapper
  const logMatch = text.match(/<log[^>]*>([\s\S]*?)<\/log>/);
  if (logMatch) text = logMatch[1]!;

  // Strip XML artifacts
  if (text.includes('<?xml')) {
    text = text.replace(/<\?xml[^?]*\?>/g, '');
    text = text.replace(/<[^>]+>/g, '\n');
  }

  // Decode entities
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Split raw text into non-empty lines */
function splitLines(raw: string): string[] {
  const text = extractText(raw);
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

interface ParsedLine {
  device?: string;
  deviceName?: string;
  control?: string;
  value?: string;
  action: string;
  detail?: string;
  /** True for status events (ST/DON/DOF) — not persisted to IndexedDB */
  isStatus: boolean;
  /** Timestamp from the log line */
  timestamp?: string;
}

// ── Control code humanization ─────────────────────────────

/** ISY control code → human-readable label */
const CONTROL_LABELS: Record<string, string> = {
  ST: 'Status',
  DON: 'Turned On',
  DOF: 'Turned Off',
  DFON: 'Fast On',
  DFOF: 'Fast Off',
  OL: 'On-Level',
  RR: 'Ramp Rate',
  BATLVL: 'Battery',
  CLISPH: 'Heat Setpoint',
  CLISPC: 'Cool Setpoint',
  CLIMD: 'Climate Mode',
  CLIHUM: 'Humidity',
  CLIFS: 'Fan State',
  ERR: 'Error',
  QUERY: 'Query',
  BRT: 'Brighten',
  DIM: 'Dim',
  LOCK: 'Locked',
  UNLOCK: 'Unlocked',
  ALARM: 'Alarm',
  USRNUM: 'User Code',
  LUTEFLAG: 'Lutron Flag',
  SECMD: 'Security Mode',
  UV: 'UV Index',
  RAINRT: 'Rain Rate',
  WINDDIR: 'Wind Direction',
  SPEED: 'Wind Speed',
  TEMPOUT: 'Outdoor Temp',
  BARPRES: 'Barometric Pressure',
  GV0: 'Custom 0',
  GV1: 'Custom 1',
  GV2: 'Custom 2',
  GV3: 'Custom 3',
  GV4: 'Custom 4',
  GV5: 'Custom 5',
};

/** Humanize a control+value pair into a readable action string */
function humanizeAction(control: string, value: string): string {
  const label = CONTROL_LABELS[control];

  // Special cases with cleaner phrasing
  if (control === 'DON') {
    if (value === '255' || value === 'On') return 'Turned On';
    const pct = parseInt(value, 10);
    if (!isNaN(pct) && pct >= 0 && pct <= 255) return `Turned On (${Math.round((pct / 255) * 100)}%)`;
    return `Turned On (${value})`;
  }
  if (control === 'DOF') return 'Turned Off';
  if (control === 'DFON') return 'Fast On';
  if (control === 'DFOF') return 'Fast Off';

  if (control === 'ST') {
    if (value === 'Off' || value === '0') return 'Status: Off';
    if (value === 'On' || value === '255') return 'Status: On';
    // Try percentage
    if (value.endsWith('%')) return `Status: ${value}`;
    const num = parseInt(value, 10);
    if (!isNaN(num) && num > 0 && num < 255) return `Status: ${Math.round((num / 255) * 100)}%`;
    return `Status: ${value}`;
  }

  if (control === 'BATLVL') return `Battery: ${value}`;
  if (control === 'RR') return `Ramp Rate: ${value}`;
  if (control === 'OL') {
    const num = parseInt(value, 10);
    if (!isNaN(num)) return `On-Level: ${Math.round((num / 255) * 100)}%`;
    return `On-Level: ${value}`;
  }

  // Generic: use label if available
  if (label) return `${label}: ${value}`;
  return `${control} → ${value}`;
}

/** Status control codes — these are status reports, not commands */
const STATUS_CONTROLS = new Set([
  'ST', 'DON', 'DOF', 'DFON', 'DFOF', 'OL', 'RR',
  'BATLVL', 'CLISPH', 'CLISPC', 'CLIMD', 'CLIHUM', 'CLIFS',
  'ERR', 'QUERY', 'GV0', 'GV1', 'GV2', 'GV3', 'GV4', 'GV5',
]);

/**
 * Parse a single log line from /rest/log.
 *
 * Observed formats:
 *   "56 1C 5F 1 ST On Tue 2026/02/03 17:45:46 0 5"            (Insteon status)
 *   "56 28 D7 1 ST 40% Tue 2026/02/03 17:24:26 0 5"           (dimmer level)
 *   "71 A2 4 1 ST Off Tue 2026/03/03 06:26:02 0 5"            (1-digit hex octet)
 *   "ZY013_1 BATLVL 87% Tue 2026/03/03 04:59:18 0 5"          (Z-Wave device)
 *   "n001_irbutton_11b ST Idle Tue 2026/02/03 17:19:10 0 5"   (node server)
 *   "[All           ] Writing 154 bytes to devices"            (operational)
 *   "[Dining Chandelier] Start : Removing from scene 'Downstairs'"  (scene op)
 *   "[PLM] Group 18 : Deleting Controller Link matching ..."        (PLM op)
 *   "Link    57 : 0E30 [hex] Writing [hex]"                    (link table write)
 */
function parseLine(line: string): ParsedLine | null {
  if (!line || line.length < 5) return null;

  // ── Bracketed format: [DeviceName] or [XX XX XX X] or [All] or [PLM] ──
  const bracketMatch = line.match(/^\[([^\]]+)\]\s*(.*)/);
  if (bracketMatch) {
    const id = bracketMatch[1]!.trim();
    const rest = bracketMatch[2]!.trim();
    const { device, deviceName } = resolveId(id);
    const detail = categorizeOperation(rest);
    return { device, deviceName, action: rest || line, detail, isStatus: false };
  }

  // ── Link table format: "Link  57 : 0E30 [hex] Writing [hex]" ──
  if (line.startsWith('Link') || /^\s*Link\s+\d+/.test(line)) {
    return { action: line.trim(), detail: 'Link table write', isStatus: false };
  }

  // ── Z-Wave device format: "ZY013_1 BATLVL 87% Tue 2026/03/03 ..." ──
  // Z-Wave prefixes: ZW, ZY, ZL, ZR (see device-types.ts regex)
  // Value capture uses `.+?` (non-greedy) because values can be multi-word
  // (e.g., "RR 2.0 seconds", "BATLVL 87%")
  const zwaveMatch = line.match(
    /^(Z[WYLR]\d+_\d+)\s+(\w+)\s+(.+?)\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2}:\d{2})/i,
  );
  if (zwaveMatch) {
    const nodeId = zwaveMatch[1]!;
    const control = zwaveMatch[2]!;
    const value = zwaveMatch[3]!.trim();
    const timestamp = zwaveMatch[4]!;
    const { device, deviceName } = resolveZWaveAddr(nodeId);
    const isStatus = STATUS_CONTROLS.has(control)
      && !line.toLowerCase().includes('fail');
    return {
      device: device ?? nodeId,
      deviceName,
      control,
      value,
      action: humanizeAction(control, value),
      detail: timestamp,
      isStatus,
      timestamp,
    };
  }

  // ── Standard Insteon format: "XX XX XX N <ctrl> <val> <day> <date> <time> <t> <l>" ──
  // Note: hex octets may be 1-2 digits (e.g., "71 A2 4" instead of "71 A2 04")
  // Value capture uses `.+?` (non-greedy) to handle multi-word values like "2.0 seconds"
  const statusMatch = line.match(
    /^([0-9A-Fa-f]{1,2}\s[0-9A-Fa-f]{1,2}\s[0-9A-Fa-f]{1,2}\s[0-9A-Fa-f]+)\s+(\w+)\s+(.+?)\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2}:\d{2})/,
  );
  if (statusMatch) {
    const addrRaw = statusMatch[1]!;
    const control = statusMatch[2]!;
    const value = statusMatch[3]!.trim();
    const timestamp = statusMatch[4]!;
    const { device, deviceName } = resolveInsteonAddr(addrRaw);
    const isStatus = STATUS_CONTROLS.has(control)
      && !line.toLowerCase().includes('fail')
      && !line.toLowerCase().includes('error');
    return {
      device,
      deviceName,
      control,
      value,
      action: humanizeAction(control, value),
      detail: timestamp,
      isStatus,
      timestamp,
    };
  }

  // ── Node server device: "n001_irbutton_11b ST Idle ..." ──
  const nsMatch = line.match(
    /^(n\d+_\S+)\s+(\w+)\s+(.+?)\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2}:\d{2})/,
  );
  if (nsMatch) {
    const nodeId = nsMatch[1]!;
    const control = nsMatch[2]!;
    const value = nsMatch[3]!.trim();
    const timestamp = nsMatch[4]!;
    const nodeInfo = useDeviceStore.getState().nodeMap.get(nodeId);
    return {
      device: nodeId,
      deviceName: nodeInfo?.name,
      control,
      value,
      action: humanizeAction(control, value),
      detail: timestamp,
      isStatus: true,
      timestamp,
    };
  }

  // ── Fallback: unrecognized format — still add to live feed but treat as status
  // (don't persist to IndexedDB) since we can't categorize it meaningfully ──
  return { action: line.trim(), isStatus: true };
}

/**
 * Convert "56 1C 5F 1" → display address "56.1C.5F" and resolve device name.
 *
 * The nodeMap uses the raw ISY format as keys: "56 1C 5F 1" (space-separated
 * with sub-node). We look up using that format, then convert to dotted format
 * for display.
 */
function resolveInsteonAddr(raw: string): { device?: string; deviceName?: string } {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 3) return {};

  // Normalize hex to 2 digits with uppercase
  const hex = parts.slice(0, 3).map((p) => p.toUpperCase().padStart(2, '0'));
  const displayAddr = hex.join('.');

  // Look up in nodeMap using the ISY's space-separated format with sub-node
  // Sub-node defaults to 1 if not present in the log line
  const subNode = parts[3] ?? '1';
  const lookupKey = `${hex[0]} ${hex[1]} ${hex[2]} ${subNode}`;
  const nodeInfo = useDeviceStore.getState().nodeMap.get(lookupKey);

  return { device: displayAddr, deviceName: nodeInfo?.name };
}

/**
 * Resolve a Z-Wave address like "ZY013_1" to a device name.
 * The nodeMap key may use underscore (ZY013_1) or space (ZY013 1) format.
 */
function resolveZWaveAddr(nodeId: string): { device?: string; deviceName?: string } {
  const nodeMap = useDeviceStore.getState().nodeMap;

  // Try exact match first (underscore format)
  const nodeInfo = nodeMap.get(nodeId);
  if (nodeInfo) return { device: nodeId, deviceName: nodeInfo.name };

  // Try space-separated format (ZY013_1 → ZY013 1)
  const spaceId = nodeId.replace(/_/g, ' ');
  const spaceInfo = nodeMap.get(spaceId);
  if (spaceInfo) return { device: nodeId, deviceName: spaceInfo.name };

  // Try without sub-node (some nodeMap entries might use base only)
  const baseParts = nodeId.match(/^(Z[WYLR]\d+)/i);
  if (baseParts) {
    for (const [key, node] of nodeMap) {
      if (key.startsWith(baseParts[1]!)) {
        return { device: nodeId, deviceName: node.name };
      }
    }
  }

  return { device: nodeId };
}

/** Resolve a bracketed ID — could be a device name, address, "All", "PLM", etc. */
function resolveId(id: string): { device?: string; deviceName?: string } {
  // Check for Insteon address format (1-2 digit hex octets)
  const addrMatch = id.match(/^([0-9A-Fa-f]{1,2}\s[0-9A-Fa-f]{1,2}\s[0-9A-Fa-f]{1,2})/);
  if (addrMatch) return resolveInsteonAddr(addrMatch[1]!);

  // Special IDs
  if (id === 'All' || id === 'PLM') return { deviceName: id };

  // Try as device name — look up in nodeMap by name
  for (const [addr, node] of useDeviceStore.getState().nodeMap) {
    if (node.name === id) {
      // Convert nodeMap key (e.g., "56 28 D7 1") to display format
      const insteonParts = addr.match(/^([0-9A-Fa-f]{1,2})\s([0-9A-Fa-f]{1,2})\s([0-9A-Fa-f]{1,2})/);
      const displayAddr = insteonParts
        ? [insteonParts[1], insteonParts[2], insteonParts[3]].map((p) => p!.toUpperCase().padStart(2, '0')).join('.')
        : addr;
      return { device: displayAddr, deviceName: id };
    }
  }

  return { deviceName: id };
}

/** Categorize bracketed-format operations */
function categorizeOperation(text: string): string | undefined {
  if (text.includes('Removing from scene') || text.includes('Adding to scene')) return 'Scene membership';
  if (text.includes('Start :') || text.includes('Finish :')) return 'Scene operation';
  if (text.includes('Controller Link') || text.includes('Responder Link')) return 'PLM operation';
  if (text.includes('Writing') && text.includes('bytes')) return 'Bulk write';
  if (text.includes('Memory') && text.includes('Write')) return 'Memory write';
  if (text.includes('as Controller') || text.includes('as Responder')) return 'Link change';
  if (text.includes('Deleting')) return 'Link delete';
  if (text.includes('Group') && text.includes('Cleanup')) return 'Group cleanup';
  return undefined;
}

// ─── Processing ─────────────────────────────────────────────

/**
 * Process a batch of new lines:
 * - ALL lines → liveEntries (in-memory ring buffer for real-time display)
 * - Operational lines only → IndexedDB (for persistent log and "All" tab)
 *
 * IndexedDB writes are fire-and-forget (no await) to avoid blocking the main
 * thread during large batch ingestions (e.g., 500+ lines at startup).
 */
function processLines(lines: string[]): { total: number; persisted: number } {
  const addEntry = useLogStore.getState().addEntry;
  const newLive: EisyLiveEntry[] = [];
  let persisted = 0;
  const now = new Date();

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;

    // Always add to the live feed
    newLive.push({
      id: ++liveIdCounter,
      device: parsed.device,
      deviceName: parsed.deviceName,
      control: parsed.control,
      value: parsed.value,
      action: parsed.action,
      detail: parsed.detail,
      isStatus: parsed.isStatus,
      timestamp: parsed.timestamp ?? now.toLocaleString(),
      raw: line,
    });

    // Only persist operational events (non-status) to IndexedDB.
    // Fire-and-forget — don't block the main thread with sequential awaits.
    if (!parsed.isStatus) {
      const isFail = parsed.action.toLowerCase().includes('fail') ||
                     parsed.action.toLowerCase().includes('error');
      addEntry({
        category: 'eisy',
        device: parsed.device,
        deviceName: parsed.deviceName,
        action: parsed.action,
        source: 'eisy',
        result: isFail ? 'fail' : 'success',
        detail: parsed.detail,
        rawCommand: line,
      }).catch((err) => {
        console.error('[EisyLog] Failed to persist entry:', err);
      });
      persisted++;
    }
  }

  // Append to the live ring buffer (newest first, capped)
  if (newLive.length > 0) {
    const store = useEisyLogStore;
    store.setState((s) => ({
      liveEntries: [...newLive.reverse(), ...s.liveEntries].slice(0, MAX_LIVE_ENTRIES),
    }));
  }

  return { total: newLive.length, persisted };
}

// ─── Poll cycle ─────────────────────────────────────────────

async function poll(): Promise<void> {
  const store = useEisyLogStore;

  try {
    const raw = await fetchEventLog();
    if (!raw) return;

    const allLines = splitLines(raw);
    const total = allLines.length;

    // Only process lines that appeared AFTER our last known count
    if (total <= lastLineCount) {
      if (total < lastLineCount) {
        // Buffer was cleared or wrapped — reset tracking
        lastLineCount = total;
      }
      return;
    }

    // New lines are the tail beyond what we've already seen
    const newLines = allLines.slice(lastLineCount);
    lastLineCount = total;

    if (newLines.length === 0) return;

    const { persisted } = processLines(newLines);
    if (persisted > 0) {
      store.setState((s) => ({
        persistedCount: s.persistedCount + persisted,
        lastError: null,
      }));
    }
  } catch (err) {
    store.setState({
      lastError: err instanceof Error ? err.message : 'Poll failed',
    });
  }
}

// ─── Store ──────────────────────────────────────────────────

export const useEisyLogStore = create<EisyLogState>((set, get) => ({
  initialized: false,
  polling: false,
  level: 1,
  persistedCount: 0,
  lastError: null,
  liveEntries: [],

  init: async (level: EisyLogLevel = 1) => {
    if (get().initialized) return;

    // Set debug level so the eisy starts buffering operational events
    try {
      await setDebugLevel(level);
    } catch (err) {
      console.warn('[EisyLog] Failed to set debug level:', err);
    }

    set({ initialized: true, level, lastError: null });

    // Fetch the current buffer — parse everything into the live feed
    // and persist operational events to IndexedDB.
    try {
      const raw = await fetchEventLog();
      if (raw) {
        const lines = splitLines(raw);
        lastLineCount = lines.length;

        if (lines.length > 0) {
          const { total, persisted } = processLines(lines);
          set({ persistedCount: persisted });
          console.log(`[EisyLog] Processed ${total} events (${persisted} operational persisted, ${lines.length} lines in buffer)`);
        }
      }
    } catch (err) {
      console.warn('[EisyLog] Failed to fetch initial log:', err);
    }
  },

  startPolling: () => {
    if (pollTimer) return;
    pollTimer = setInterval(poll, POLL_INTERVAL);
    set({ polling: true });
    // Immediate fetch when polling starts
    void poll();
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    set({ polling: false });
  },

  setLevel: async (level: EisyLogLevel) => {
    try {
      await setDebugLevel(level);
      // Clear stale entries and reset buffer tracking so the next poll
      // re-fetches the full buffer at the new verbosity level.
      lastLineCount = 0;
      set({ level, liveEntries: [] });
    } catch (err) {
      console.warn('[EisyLog] Failed to set debug level:', err);
    }
  },

  reset: async () => {
    try {
      await resetEventLog();
      lastLineCount = 0;
      set({ persistedCount: 0, liveEntries: [] });
    } catch (err) {
      console.warn('[EisyLog] Failed to reset event log:', err);
    }
  },
}));
