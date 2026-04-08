/**
 * Program D2D XML Humanizer — converts ISY D2D program definitions
 * (IF conditions, THEN/ELSE actions) into human-readable text lines.
 *
 * Extracted from ProgramDetail.tsx for shared use by:
 * - ProgramDetail component (UI rendering)
 * - AI traceability tools (text output)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HumanLine {
  text: string;
  indent: number;
}

export type NameResolver = (raw: string) => string;

type ValueContext = 'condition' | 'action';

// ─── Constants ───────────────────────────────────────────────────────────────

/** D2D command ID → human-readable verb mapping */
export const CMD_NAMES: Record<string, string> = {
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
export const OP_NAMES: Record<string, string> = {
  IS: 'is', NOT: 'is not', GT: '>', LT: '<', GTE: '≥', LTE: '≤',
};

/** Control-event labels: in <control> context, GV1/GV2 mean Pressed/Held (IR buttons) */
export const CONTROL_EVENT_NAMES: Record<string, string> = {
  DON: 'On', DOF: 'Off', DFON: 'Fast On', DFOF: 'Fast Off',
  GV1: 'Pressed', GV2: 'Held',
};

// ─── Name Resolution ─────────────────────────────────────────────────────────

/**
 * Build a unified name resolver that maps device addresses, scene addresses,
 * and program IDs to human-readable names. Handles multiple address formats.
 */
export function buildNameResolver(
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

// ─── Value & Time Formatting ─────────────────────────────────────────────────

/** UOM ID → unit suffix */
export function getUomSuffix(uom: string | undefined): string {
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
 * - CMD ACTIONS: UOM 51 values use 0-255 byte scale. 255 = 100%, 0 = 0%.
 */
export function formatValue(rawVal: string, uom: string | undefined, _propId?: string, context: ValueContext = 'condition'): string {
  if (!rawVal) return '';
  const num = parseInt(rawVal, 10);

  if (uom === '51') {
    if (context === 'action') {
      if (num === 255) return '100%';
      if (num === 0) return '0%';
      return `${Math.round((num / 255) * 100)}%`;
    }
    return `${num}%`;
  }
  if (uom === '100') {
    if (num === 255) return '100%';
    if (num === 0) return '0%';
    return `${Math.round((num / 255) * 100)}%`;
  }
  return `${rawVal}${getUomSuffix(uom)}`;
}

/** Parse a schedule time reference (sunrise, sunset, or clock time) */
export function parseTimeRef(xml: string): string {
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

// ─── Block Humanizers ────────────────────────────────────────────────────────

/** Humanize a <schedule> block */
export function humanizeSchedule(inner: string): string {
  const fromMatch = inner.match(/<from>([\s\S]*?)<\/from>/);
  const toMatch = inner.match(/<to>([\s\S]*?)<\/to>/);
  const atMatch = inner.match(/<at>([\s\S]*?)<\/at>/);

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
export function humanizeWait(inner: string): string {
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
export function humanizeStatus(attrs: Record<string, string>, inner: string, resolver: NameResolver): string {
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
export function humanizeCmd(attrs: Record<string, string>, inner: string, resolver: NameResolver): string {
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

/** Humanize a <control> condition */
export function humanizeControl(attrs: Record<string, string>, resolver: NameResolver): string {
  const node = attrs.node ? resolver(attrs.node) : '';
  const eventName = CONTROL_EVENT_NAMES[attrs.id ?? ''];

  if (eventName) return `${node} is switched ${eventName}`;

  const cmd = CMD_NAMES[attrs.id ?? ''] ?? attrs.id ?? '?';
  const op = OP_NAMES[attrs.op ?? ''] ?? attrs.op ?? '';
  return `${node} ${cmd} ${op}`.replace(/\s+/g, ' ').trim();
}

/** Extract attributes from an XML tag string */
export function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    if (m[1] !== undefined) attrs[m[1]] = m[2] ?? '';
  }
  return attrs;
}

// ─── Main Humanizer ──────────────────────────────────────────────────────────

/**
 * Parse D2D XML block into human-readable lines.
 *
 * Strategy: First extract multi-tag constructs (schedule, wait, cmd, status)
 * using regex and replace with inline markers. Then parse remaining single tags
 * (and, or, paren, control) with the token-based approach.
 */
export function humanizeD2DBlock(xml: string, resolver: NameResolver, notificationMap: Map<string, string> = new Map()): HumanLine[] {
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

  // 1. Schedules
  processed = processed.replace(/<schedule>([\s\S]*?)<\/schedule>/g, (_, inner: string) =>
    addMarker(humanizeSchedule(inner)),
  );

  // 2. Wait blocks
  processed = processed.replace(/<wait>([\s\S]*?)<\/wait>/g, (_, inner: string) =>
    addMarker(humanizeWait(inner)),
  );

  // 3. Status conditions
  processed = processed.replace(/<status([^>]*)>([\s\S]*?)<\/status>/g, (_, attrStr: string, inner: string) =>
    addMarker(humanizeStatus(parseAttrs(`<status${attrStr}>`), inner, resolver)),
  );

  // 4. Cmd actions (with children)
  processed = processed.replace(/<cmd([^/]*?)>([\s\S]*?)<\/cmd>/g, (_, attrStr: string, inner: string) =>
    addMarker(humanizeCmd(parseAttrs(`<cmd${attrStr}>`), inner, resolver)),
  );

  // 5. Self-closing cmd
  processed = processed.replace(/<cmd([^>]*?)\/>/g, (_, attrStr: string) =>
    addMarker(humanizeCmd(parseAttrs(`<cmd${attrStr}/>`), '', resolver)),
  );

  // 6. Self-closing control
  processed = processed.replace(/<control([^>]*?)\/>/g, (_, attrStr: string) =>
    addMarker(humanizeControl(parseAttrs(`<control${attrStr}/>`), resolver)),
  );

  // 7. Non-self-closing control
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

  // 9. Notify
  processed = processed.replace(/<notify\s*([^>]*)>([^<]*)<\/notify>/g, (_match, attrStr: string, channelId: string) => {
    const contentMatch = attrStr.match(/content="([^"]*)"/);
    const contentId = contentMatch?.[1] ?? '';
    const channel = channelId.trim();
    const notifyName = notificationMap.get(channel) ?? notificationMap.get(contentId);
    if (notifyName) return addMarker(`Send Notification to '${notifyName}'`);
    if (channel || contentId) return addMarker(`Send Notification (channel ${channel || contentId})`);
    return addMarker('Send notification');
  });

  // 10. Device/net commands
  processed = processed.replace(/<device>[\s\S]*?<\/device>/g, () => addMarker('Query all devices'));
  processed = processed.replace(/<net>[\s\S]*?<\/net>/g, () => addMarker('Network resource command'));

  // Parse remaining tokens (conjunctions, grouping, markers)
  const tokens = processed.match(/<[^>]+\/?>/g) || [];
  const lines: HumanLine[] = [];
  let indent = 0;

  for (const token of tokens) {
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

    if (tagName.startsWith('_M') && markers.has(tagName)) {
      lines.push({ text: markers.get(tagName)!, indent });
      continue;
    }

    if (tagName === 'and') lines.push({ text: 'AND', indent });
    else if (tagName === 'or') lines.push({ text: 'OR', indent });
    else if (tagName === 'not') lines.push({ text: 'NOT', indent });
    else if (tagName === 'paren') { lines.push({ text: '(', indent }); indent++; }
  }

  if (lines.length === 0) {
    const cleaned = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    lines.push({ text: cleaned.substring(0, 500) || '(empty)', indent: 0 });
  }

  return lines;
}
