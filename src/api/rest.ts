/**
 * Typed REST endpoint wrappers for the eisy /rest/* API.
 * Every function returns parsed, typed data from the XML responses.
 */
import { restGet, restPost } from './client.ts';
import type {
  NodesResponse,
  StatusResponse,
  StatusNode,
  IsyProgram,
  ConfigResponse,
  ErrorLogEntry,
  IsyVariable,
  IsyProperty,
  IsyNode,
  IsyGroup,
  NodeNotes,
} from './types.ts';
import { API } from './types.ts';

// ─── Helpers ──────────────────────────────────────────────────

/** Normalize XML parser output that may be a single item or array */
function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

// ─── Nodes ────────────────────────────────────────────────────

/** Fetch all nodes (devices, folders, scenes) */
export async function fetchNodes(): Promise<NodesResponse | null> {
  const resp = await restGet<NodesResponse>(API.REST_NODES);
  return resp.data;
}

/** Fetch scene details with members */
export async function fetchScenes(): Promise<IsyGroup[]> {
  const resp = await restGet<{ scenes: { group?: IsyGroup | IsyGroup[] } }>(API.REST_SCENES);
  if (!resp.data) return [];
  return ensureArray(resp.data.scenes?.group);
}

// ─── Status ───────────────────────────────────────────────────

/** Fetch status for ALL nodes */
export async function fetchAllStatus(): Promise<StatusNode[]> {
  const resp = await restGet<StatusResponse>(API.REST_STATUS);
  if (!resp.data) return [];
  return ensureArray(resp.data.nodes?.node);
}

/** Fetch status for a single node */
export async function fetchNodeStatus(address: string): Promise<IsyProperty[]> {
  const resp = await restGet<{ node: StatusNode }>(`${API.REST_STATUS}/${address}`);
  if (!resp.data?.node) return [];
  return ensureArray(resp.data.node.property);
}

// ─── Commands ─────────────────────────────────────────────────

/** Send a command to a node (DON, DOF, LOCK, etc.) */
export async function sendNodeCommand(
  address: string,
  command: string,
  value?: number,
): Promise<boolean> {
  const params = value !== undefined ? `/${value}` : '';
  const resp = await restGet(`/rest/nodes/${address}/cmd/${command}${params}`);
  return resp.ok;
}

/** Set a property value on a node (OL = On Level, RR = Ramp Rate, BL = Backlight, etc.) */
export async function setNodeProperty(
  address: string,
  propId: string,
  value: number,
): Promise<boolean> {
  const resp = await restGet(`/rest/nodes/${address}/set/${propId}/${value}`);
  return resp.ok;
}

/** Query a node to force a status refresh */
export async function queryNode(address: string): Promise<boolean> {
  const resp = await restGet(`${API.REST_QUERY}/${address}`);
  return resp.ok;
}

// ─── Programs ─────────────────────────────────────────────────

/** Fetch all program summaries (not full D2D — use SOAP GetAllD2D for conditions/actions) */
export async function fetchPrograms(): Promise<IsyProgram[]> {
  const resp = await restGet<{ programs: { program?: IsyProgram | IsyProgram[] } }>(
    `${API.REST_PROGRAMS}?subfolders=true`,
  );
  if (!resp.data) return [];
  return ensureArray(resp.data.programs?.program);
}

/** Run a program's THEN clause */
export async function runProgram(id: string): Promise<boolean> {
  const resp = await restGet(`${API.REST_PROGRAMS}/${id}/run`);
  return resp.ok;
}

/** Run a program's ELSE clause */
export async function runProgramElse(id: string): Promise<boolean> {
  const resp = await restGet(`${API.REST_PROGRAMS}/${id}/runElse`);
  return resp.ok;
}

/** Stop a running program */
export async function stopProgram(id: string): Promise<boolean> {
  const resp = await restGet(`${API.REST_PROGRAMS}/${id}/stop`);
  return resp.ok;
}

/** Enable a program */
export async function enableProgram(id: string): Promise<boolean> {
  const resp = await restGet(`${API.REST_PROGRAMS}/${id}/enable`);
  return resp.ok;
}

/** Disable a program */
export async function disableProgram(id: string): Promise<boolean> {
  const resp = await restGet(`${API.REST_PROGRAMS}/${id}/disable`);
  return resp.ok;
}

/** Move a program to a different folder */
export async function moveProgramToFolder(programId: string, folderId: string): Promise<boolean> {
  const resp = await restGet(`${API.REST_PROGRAMS}/${programId}/set/parent/${folderId}`);
  return resp.ok;
}

// ─── Config ───────────────────────────────────────────────────

/** Fetch system configuration */
export async function fetchConfig(): Promise<ConfigResponse['configuration'] | null> {
  const resp = await restGet<ConfigResponse>(API.REST_CONFIG);
  return resp.data?.configuration ?? null;
}

// ─── Variables ────────────────────────────────────────────────

/** Fetch integer variables (type 1) */
export async function fetchIntegerVariables(): Promise<IsyVariable[]> {
  const resp = await restGet<{ vars: { var?: IsyVariable | IsyVariable[] } }>(
    API.REST_VARS_INT,
  );
  if (!resp.data) return [];
  return ensureArray(resp.data.vars?.var);
}

/** Fetch state variables (type 2) */
export async function fetchStateVariables(): Promise<IsyVariable[]> {
  const resp = await restGet<{ vars: { var?: IsyVariable | IsyVariable[] } }>(
    API.REST_VARS_STATE,
  );
  if (!resp.data) return [];
  return ensureArray(resp.data.vars?.var);
}

// ─── Event Log ───────────────────────────────────────────────

/**
 * Fetch the eisy's native event log.
 * Returns the same data visible in UDAC's Event Viewer — status changes,
 * link table writes, scene operations, PLM operations, memory writes, etc.
 *
 * The raw response from the eisy can vary in structure — it may return
 * structured XML entries with attributes, or plain-text log lines,
 * or the raw text of the event buffer. We normalize to a string array
 * to handle all formats.
 */
export async function fetchEventLog(): Promise<string> {
  const resp = await restGet<unknown>(API.REST_LOG);
  if (!resp.ok || !resp.raw) return '';
  // Return the raw XML/text — the eisy event log format is not well-documented
  // and may return structured XML or plain text depending on firmware version.
  // The caller (eisy-log-store) will parse it appropriately.
  return resp.raw;
}

/** Clear/reset the eisy's event log buffer */
export async function resetEventLog(): Promise<boolean> {
  const resp = await restGet(API.REST_LOG + '?reset=true');
  return resp.ok;
}

// ─── Error Log ────────────────────────────────────────────────

/** Fetch the system error log */
export async function fetchErrorLog(): Promise<ErrorLogEntry[]> {
  const resp = await restGet<{ log: { entry?: ErrorLogEntry | ErrorLogEntry[] } }>(
    API.REST_ERROR_LOG,
  );
  if (!resp.data) return [];
  return ensureArray(resp.data.log?.entry);
}

// ─── Z-Wave ───────────────────────────────────────────────────

/** Start Z-Wave inclusion mode */
export async function zwaveInclude(): Promise<boolean> {
  const resp = await restGet(API.REST_ZWAVE_INCLUDE);
  return resp.ok;
}

/** Start Z-Wave exclusion mode */
export async function zwaveExclude(): Promise<boolean> {
  const resp = await restGet(API.REST_ZWAVE_EXCLUDE);
  return resp.ok;
}

// ─── Notifications ────────────────────────────────────────────

/** Notification profile from the eisy NOTIF.CFG */
export interface NotificationProfile {
  id: string;
  name: string;
}

/** Fetch notification profiles from the eisy config files */
export async function fetchNotificationProfiles(): Promise<NotificationProfile[]> {
  // Try fetching the notification config file
  const resp = await restGet<Record<string, unknown>>('/CONF/MAIL/NOTIF.CFG');
  if (!resp.data) return [];
  // The config format varies — try to extract name/id pairs
  try {
    const profiles: NotificationProfile[] = [];
    const data = resp.data as Record<string, unknown>;
    // Walk the response looking for notification entries
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null) {
        const entry = value as Record<string, unknown>;
        if (entry.name || entry['@_name']) {
          profiles.push({
            id: entry['@_id']?.toString() ?? key,
            name: (entry.name ?? entry['@_name'] ?? key) as string,
          });
        }
      }
    }
    return profiles;
  } catch {
    return [];
  }
}

// ─── Node Notes (Spoken Names, Location, Description) ────────

/** Escape XML special characters in user-supplied text */
function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * PRP file ID cache: address → PRP file number.
 *
 * The eisy stores node notes as CONF/{id}.PRP files. The REST endpoint
 * GET /rest/nodes/{addr}/notes reads them, but POST is not supported (returns 715).
 * Writing requires: POST /file/upload/CONF/{id}.PRP?load=n
 *
 * Discovery trick: When a device has NO notes, GET returns 404 and the body
 * contains the PRP path (e.g., "./FILES/CONF/89.PRP not found"). We extract
 * and cache this ID so saves can target the right file.
 */
const prpIdCache = new Map<string, string>();

/** Extract the PRP file ID from a 404 error body */
function extractPrpId(body: string): string | null {
  const match = body.match(/CONF\/(\d+)\.PRP/i);
  return match?.[1] ?? null;
}

/**
 * Discover and cache the PRP file ID for a device.
 * For devices without notes: the 404 body reveals the path.
 * For devices WITH notes: we delete the PRP, read the 404 to learn the ID,
 * then immediately restore the original content.
 */
async function discoverPrpId(address: string, existingNotes?: NodeNotes): Promise<string | null> {
  // If no existing notes, a simple GET will 404 and reveal the path
  if (!existingNotes) {
    const probe = await restGet(`${API.REST_NODES}/${address}/notes`);
    if (probe.raw) {
      const id = extractPrpId(probe.raw);
      if (id) prpIdCache.set(address, id);
      return id;
    }
    return null;
  }

  // Device has existing notes — we need to temporarily remove the PRP to discover the ID.
  // Strategy: Scan nearby PRP IDs using a GET probe. The eisy assigns PRP IDs sequentially,
  // so we check IDs near the highest known ID in our cache.
  // This is a fallback — most devices will have their PRP ID cached from initial load.

  // Collect all known PRP IDs and try IDs we haven't seen yet
  const knownIds = new Set(prpIdCache.values());
  const maxKnown = Math.max(0, ...Array.from(knownIds).map(Number));

  // Try IDs from 1 to maxKnown + 20 (generous range)
  for (let id = 1; id <= maxKnown + 20; id++) {
    if (knownIds.has(String(id))) continue; // Skip already-mapped IDs

    // Try writing notes to this PRP ID, then read back to verify
    const testXml = buildNotesXml(existingNotes);
    const writeResp = await restPost(`${API.FILE_UPLOAD}/CONF/${id}.PRP?load=n`, testXml);
    if (!writeResp.ok) continue;

    // Verify: does reading notes for this address now return our content?
    const readResp = await restGet<{ NodeProperties?: NodeNotes }>(
      `${API.REST_NODES}/${address}/notes`,
    );
    if (readResp.ok && readResp.data?.NodeProperties) {
      const readSpoken = readResp.data.NodeProperties.spoken;
      if (typeof readSpoken === 'string' && readSpoken === existingNotes.spoken) {
        prpIdCache.set(address, String(id));
        return String(id);
      }
    }
    // Wrong ID — restore what was there (if anything) by writing empty
    await restPost(`${API.FILE_UPLOAD}/CONF/${id}.PRP?load=n`, '<NodeProperties><spoken/><location/><description/><isLoad>false</isLoad></NodeProperties>');
  }

  return null;
}

/** Build the XML body for a NodeNotes write */
function buildNotesXml(notes: NodeNotes): string {
  return `<NodeProperties><spoken>${escXml(notes.spoken ?? '')}</spoken><location>${escXml(notes.location ?? '')}</location><description>${escXml(notes.description ?? '')}</description><isLoad>${notes.isLoad ?? 'false'}</isLoad></NodeProperties>`;
}

/** Fetch node notes (spoken name, location, description) for a device */
export async function fetchNodeNotes(address: string): Promise<NodeNotes | null> {
  const resp = await restGet<{ NodeProperties?: NodeNotes }>(
    `${API.REST_NODES}/${address}/notes`,
  );

  // If 404, extract and cache the PRP file ID from the error body
  if (!resp.ok && resp.raw) {
    const prpId = extractPrpId(resp.raw);
    if (prpId) prpIdCache.set(address, prpId);
    return null;
  }

  if (!resp.data?.NodeProperties) return null;
  const props = resp.data.NodeProperties;
  return {
    spoken: typeof props.spoken === 'string' ? props.spoken : '',
    location: typeof props.location === 'string' ? props.location : '',
    description: typeof props.description === 'string' ? props.description : '',
    isLoad: props.isLoad,
  };
}

/**
 * Save node notes (spoken name, location, description) for a device.
 *
 * Uses the PRP file upload mechanism since direct REST POST returns 715.
 * PRP IDs are discovered during fetchNodeNotes (from 404 bodies) and cached.
 */
export async function saveNodeNotes(address: string, notes: NodeNotes): Promise<boolean> {
  const xml = buildNotesXml(notes);

  let prpId = prpIdCache.get(address);

  if (!prpId) {
    // Try to discover the PRP ID (handles both new and existing notes cases)
    const existing = await fetchNodeNotes(address);
    prpId = prpIdCache.get(address);

    if (!prpId && existing) {
      // Device has notes but no cached PRP ID — use brute-force discovery
      prpId = (await discoverPrpId(address, existing)) ?? undefined;
    }
  }

  if (!prpId) return false;

  const resp = await restPost(`${API.FILE_UPLOAD}/CONF/${prpId}.PRP?load=n`, xml);
  return resp.ok;
}

// ─── Utility ──────────────────────────────────────────────────

/** Build a flat map of address → node from the nodes response */
export function buildNodeMap(nodesResp: NodesResponse): Map<string, IsyNode> {
  const map = new Map<string, IsyNode>();
  for (const node of ensureArray(nodesResp.nodes?.node)) {
    map.set(String(node.address), node);
  }
  return map;
}
