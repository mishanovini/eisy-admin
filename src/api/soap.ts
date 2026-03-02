/**
 * SOAP operation wrappers for the eisy /services endpoint.
 *
 * IMPORTANT: Two different SOAP service URNs exist:
 *   - X_Insteon_Lighting_Service:1 — most operations including GetAllD2D
 *   - X_IoX_Service:1              — D2DCommand only
 * These are NOT interchangeable. Using the wrong URN returns 501.
 */
import { soapCall, restPost } from './client.ts';
import type { D2DResponse, D2DTrigger, SoapResult } from './types.ts';
import { SOAP_SERVICE } from './types.ts';

// ─── Helpers ──────────────────────────────────────────────────

/** Escape XML special characters in values */
function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert a decimal program ID to 4-digit uppercase hex */
export function toHexId(id: number): string {
  return id.toString(16).toUpperCase().padStart(4, '0');
}

/** Generate a new D2D session key (matches Admin Console format) */
export function generateD2DKey(): string {
  const mask = 0xffffffffn;
  const ts = BigInt(Date.now()) & mask;
  const rand = Math.floor(Math.random() * 0xffff);
  return `${ts.toString(16).toUpperCase()}.${rand.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Build a SoapResult from our API response */
function toSoapResult(resp: { ok: boolean; status: number; error?: string }): SoapResult {
  return { success: resp.ok, status: resp.status, info: resp.error };
}

// ─── D2D Programs ─────────────────────────────────────────────

/** Read all programs with full IF/THEN/ELSE definitions + session key */
export async function getAllD2D(): Promise<D2DResponse | null> {
  const resp = await soapCall<unknown>('GetAllD2D', SOAP_SERVICE.INSTEON, '');

  if (!resp.ok || !resp.raw) return null;

  // Extract the key from the response
  const keyMatch = resp.raw.match(/<key>([^<]+)<\/key>/);
  const key = keyMatch?.[1] ?? '';

  // Extract triggers — the response wraps them in a SOAP envelope
  // The parsed XML structure varies; extract triggers from raw XML for reliability
  const triggers: D2DTrigger[] = [];
  const triggerRegex = /<trigger>([\s\S]*?)<\/trigger>/g;
  let match: RegExpExecArray | null;

  while ((match = triggerRegex.exec(resp.raw)) !== null) {
    const xml = match[1]!;
    const getId = (tag: string) => {
      const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m?.[1] ?? '';
    };

    triggers.push({
      id: parseInt(getId('id'), 10),
      name: getId('name'),
      parent: parseInt(getId('parent'), 10),
      folder: xml.includes('<folder') ? 'true' : undefined,
      if: extractBlock(xml, 'if'),
      then: extractBlock(xml, 'then'),
      else: extractBlock(xml, 'else'),
      comment: getId('comment') || undefined,
    });
  }

  return { key, triggers };
}

/** Extract an XML block (if/then/else) from trigger XML */
function extractBlock(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m?.[1] || undefined;
}

/**
 * Full program save sequence (6 steps).
 * Without the broadcast commit (step 6), programs are saved to disk
 * but NOT activated by the eisy runtime.
 */
export async function saveProgramFull(
  programId: number,
  programXml: string,
  currentKey: string,
  options?: {
    enabled?: boolean;
    runAtStartup?: boolean;
  },
): Promise<SoapResult> {
  // Step 1: Rotate key (pre-save)
  const newKey1 = generateD2DKey();
  const step1 = await d2dCommand(0, currentKey, `<setKey>${newKey1}</setKey>`);
  if (!step1.success) return step1;

  // Step 2: Upload program XML
  const hexId = toHexId(programId);
  const uploadResp = await restPost(
    `/program/upload/${hexId}?key=${newKey1}`,
    programXml,
  );
  if (!uploadResp.ok) {
    return { success: false, status: uploadResp.status, info: uploadResp.error };
  }

  // Step 3: Enable/disable
  const enableTag = options?.enabled !== false ? '<enable />' : '<disable />';
  const key3 = generateD2DKey();
  await d2dCommand(programId, newKey1, `${enableTag}<setKey>${key3}</setKey>`);

  // Step 4: Run-at-reboot
  const rebootTag = options?.runAtStartup ? '<runAtReboot />' : '<notRunAtReboot />';
  const key4 = generateD2DKey();
  await d2dCommand(programId, key3, `${rebootTag}<setKey>${key4}</setKey>`);

  // Step 5: No deletions in typical save — skip

  // Step 6: Broadcast commit (CRITICAL)
  const finalKey = generateD2DKey();
  const step6 = await d2dCommand(0, key4, `<broadcast /><setKey>${finalKey}</setKey>`);

  return step6;
}

/** Delete a program with full save sequence */
export async function deleteProgram(
  programId: number,
  currentKey: string,
): Promise<SoapResult> {
  // Rotate key
  const newKey = generateD2DKey();
  await d2dCommand(0, currentKey, `<setKey>${newKey}</setKey>`);

  // Delete via HTTP
  const hexId = toHexId(programId);
  const resp = await restPost(`/program/delete/${hexId}`, '');
  if (!resp.ok) {
    return { success: false, status: resp.status, info: resp.error };
  }

  // Broadcast commit
  const finalKey = generateD2DKey();
  return d2dCommand(0, newKey, `<broadcast /><setKey>${finalKey}</setKey>`);
}

/**
 * Send a D2DCommand via SOAP.
 * IMPORTANT: Uses X_IoX_Service URN, NOT X_Insteon_Lighting_Service!
 */
export async function d2dCommand(
  programId: number,
  key: string,
  commandXml: string,
): Promise<SoapResult> {
  const innerXml = `
      <id>${programId}</id>
      <key>${escXml(key)}</key>
      <CDATA><cmd>${commandXml}</cmd></CDATA>`;

  const resp = await soapCall('D2DCommand', SOAP_SERVICE.IOX, innerXml);
  return toSoapResult(resp);
}

// ─── Node Management ──────────────────────────────────────────

/** Rename a node/device */
export async function renameNode(id: string, newName: string): Promise<SoapResult> {
  const resp = await soapCall('RenameNode', SOAP_SERVICE.INSTEON, `
      <id>${escXml(id)}</id>
      <name>${escXml(newName)}</name>`);
  return toSoapResult(resp);
}

/** Rename a scene/group */
export async function renameGroup(name: string, newName: string): Promise<SoapResult> {
  const resp = await soapCall('RenameGroup', SOAP_SERVICE.INSTEON, `
      <name>${escXml(name)}</name>
      <newName>${escXml(newName)}</newName>`);
  return toSoapResult(resp);
}

/** Remove a node/device */
export async function removeNode(id: string): Promise<SoapResult> {
  const resp = await soapCall('RemoveNode', SOAP_SERVICE.INSTEON, `
      <id>${escXml(id)}</id>`);
  return toSoapResult(resp);
}

/** Move a node to a folder */
export async function setParent(
  node: string,
  nodeType: number,
  parent: string,
  parentType: number,
): Promise<SoapResult> {
  const resp = await soapCall('SetParent', SOAP_SERVICE.INSTEON, `
      <node>${escXml(node)}</node>
      <nodeType>${nodeType}</nodeType>
      <parent>${escXml(parent)}</parent>
      <parentType>${parentType}</parentType>`);
  return toSoapResult(resp);
}

/** Start device discovery */
export async function discoverNodes(): Promise<SoapResult> {
  const resp = await soapCall('DiscoverNodes', SOAP_SERVICE.INSTEON, '');
  return toSoapResult(resp);
}

/** Write pending device updates (for battery devices, user must wake device first) */
export async function writeDeviceUpdates(node: string): Promise<SoapResult> {
  const resp = await soapCall('WriteDeviceUpdates', SOAP_SERVICE.INSTEON, `
      <node>${escXml(node)}</node>`);
  return toSoapResult(resp);
}

/** Enter device linking mode */
export async function setDeviceLinkMode(flag: number): Promise<SoapResult> {
  const resp = await soapCall('SetDeviceLinkMode', SOAP_SERVICE.INSTEON, `
      <flag>${flag}</flag>`);
  return toSoapResult(resp);
}

// ─── Scene Management ─────────────────────────────────────────

/** Remove a node from a scene/group */
export async function removeFromGroup(
  nodeId: string,
  groupName: string,
): Promise<SoapResult> {
  const resp = await soapCall('RemoveFromGroup', SOAP_SERVICE.INSTEON, `
      <id>${escXml(nodeId)}</id>
      <name>${escXml(groupName)}</name>`);
  return toSoapResult(resp);
}

/** Remove a scene/group */
export async function removeGroup(address: string): Promise<SoapResult> {
  const resp = await soapCall('RemoveGroup', SOAP_SERVICE.INSTEON, `
      <id>${escXml(address)}</id>`);
  return toSoapResult(resp);
}

// ─── Scene Properties (DeviceSpecific) ───────────────────────

/** Per-member scene property (on-level and ramp-rate) */
export interface SceneMemberProps {
  /** Node address of this member */
  node: string;
  /** On-level 0-255 (255 = 100%) */
  onLevel: number;
  /** Ramp rate index 0-31 (maps to RAMP_RATES lookup table) */
  rampRate: number;
}

/**
 * Fetch scene properties for all members via DeviceSpecific G_SP command.
 *
 * Returns per-member on-level and ramp-rate values. The eisy responds with
 * XML containing <SP> blocks for each member with <node>, <OL>, and <RR> fields.
 */
export async function getSceneProperties(sceneAddress: string): Promise<SceneMemberProps[]> {
  const resp = await soapCall('DeviceSpecific', SOAP_SERVICE.INSTEON, `
      <command>G_SP</command>
      <scene>${escXml(String(sceneAddress))}</scene>`);

  if (!resp.ok || !resp.raw) return [];

  // Parse <SP> blocks from the raw XML response
  const members: SceneMemberProps[] = [];
  const spRegex = /<SP>([\s\S]*?)<\/SP>/g;
  let match: RegExpExecArray | null;

  while ((match = spRegex.exec(resp.raw)) !== null) {
    const block = match[1]!;
    const node = extractTag(block, 'node');
    const ol = extractTag(block, 'OL');
    const rr = extractTag(block, 'RR');

    if (node) {
      members.push({
        node: String(node),
        onLevel: ol ? parseInt(ol, 10) : 255,
        rampRate: rr ? parseInt(rr, 10) : 28, // default ~0.5s
      });
    }
  }

  return members;
}

/**
 * Set the on-level for a member device within a scene.
 * @param memberAddr - Address of the member device
 * @param sceneAddr - Address of the scene
 * @param level - On-level 0-255 (0=off, 255=100%)
 */
export async function setSceneOnLevel(
  memberAddr: string,
  sceneAddr: string,
  level: number,
): Promise<SoapResult> {
  const resp = await soapCall('DeviceSpecific', SOAP_SERVICE.INSTEON, `
      <command>S_OL_SP</command>
      <node>${escXml(String(memberAddr))}</node>
      <scene>${escXml(String(sceneAddr))}</scene>
      <flag>1</flag>
      <value>${Math.round(Math.max(0, Math.min(255, level)))}</value>`);
  return toSoapResult(resp);
}

/**
 * Set the ramp rate for a member device within a scene.
 * @param memberAddr - Address of the member device
 * @param sceneAddr - Address of the scene
 * @param rateIndex - Ramp rate index 0-31 (see RAMP_RATES in scene-utils.ts)
 */
export async function setSceneRampRate(
  memberAddr: string,
  sceneAddr: string,
  rateIndex: number,
): Promise<SoapResult> {
  const resp = await soapCall('DeviceSpecific', SOAP_SERVICE.INSTEON, `
      <command>S_RR_SP</command>
      <node>${escXml(String(memberAddr))}</node>
      <scene>${escXml(String(sceneAddr))}</scene>
      <flag>1</flag>
      <value>${Math.round(Math.max(0, Math.min(31, rateIndex)))}</value>`);
  return toSoapResult(resp);
}

/** Extract text content of an XML tag from a string */
function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m?.[1] ?? null;
}

// ─── Z-Wave Config ────────────────────────────────────────────

/** Read a Z-Wave configuration parameter */
export async function queryConfigParam(
  node: string,
  param: number,
): Promise<SoapResult> {
  const resp = await soapCall('QueryConfigParam', SOAP_SERVICE.INSTEON, `
      <node>${escXml(node)}</node>
      <param>${param}</param>`);
  return toSoapResult(resp);
}

/** Write a Z-Wave configuration parameter */
export async function setConfigParam(
  id: string,
  param: number,
  value: number,
  size: number,
): Promise<SoapResult> {
  const resp = await soapCall('SetConfigParam', SOAP_SERVICE.INSTEON, `
      <id>${escXml(id)}</id>
      <param>${param}</param>
      <val>${value}</val>
      <size>${size}</size>`);
  return toSoapResult(resp);
}

// ─── System ───────────────────────────────────────────────────

/** Clear the last error state */
export async function clearLastError(): Promise<SoapResult> {
  const resp = await soapCall('ClearLastError', SOAP_SERVICE.INSTEON, '');
  return toSoapResult(resp);
}

/** Query all device statuses */
export async function queryAll(): Promise<SoapResult> {
  const resp = await soapCall('QueryAll', SOAP_SERVICE.INSTEON, '');
  return toSoapResult(resp);
}
