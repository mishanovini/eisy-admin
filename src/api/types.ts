/** Raw XML node as returned by /rest/nodes */
export interface IsyNode {
  '@_flag': number;
  '@_nodeDefId'?: string;
  address: string;
  name: string;
  /**
   * Protocol family. Insteon nodes omit this or folders use 13.
   * Z-Wave = 12, Node Server = 10 (sometimes as object with instance).
   */
  family?: number | { '@_instance'?: number; '#text': number };
  hint?: string;
  parent?: { '@_type': number; '#text': string };
  /**
   * ISY type field — dotted quad encoding device class info.
   * Insteon: "Category.SubCat.Firmware.Version" (e.g., "1.32.69.0" = dimmer)
   * Z-Wave:  "routing.generic.specific.version" (e.g., "4.64.3.0" = entry control)
   */
  type?: string;
  enabled?: boolean | string;
  deviceClass?: number;
  wattage?: number;
  pnode?: string;
  property?: IsyProperty | IsyProperty[];

  // ─── Timing (all protocols) ──────────────────────────────
  dcPeriod?: number;
  startDelay?: number;
  endDelay?: number;

  // ─── Z-Wave specific ────────────────────────────────────
  /** Routing parent node address (Z-Wave mesh routing) */
  rpnode?: string;
  /** Sub-group / endpoint ID (Z-Wave multi-channel endpoints) */
  sgid?: number;
  /** Custom Z-Wave configuration flags */
  custom?: { '@_flags': number; '@_val1': number };
  /**
   * Z-Wave device type metadata — the richest classification source.
   * - gen: "generic.specific.commandClass" (e.g., "4.64.3" = Entry Control Lock)
   * - mfg: "manufacturerId.productType.productId" (e.g., "297.32780.3840" = Yale Lock)
   * - cat: device category number (e.g., 111 = lock, 129 = repeater)
   */
  devtype?: {
    gen?: string;
    mfg?: string;
    cat?: number;
  };
}

/** Raw XML folder as returned by /rest/nodes */
export interface IsyFolder {
  '@_flag'?: number;
  address: string;
  name: string;
  family?: number;
}

/** Raw property on a node */
export interface IsyProperty {
  '@_id': string;
  '@_value': string | number;
  '@_formatted'?: string;
  '@_uom'?: string | number;
  '@_name'?: string;
  '@_prec'?: number;
}

/** Parsed /rest/nodes response */
export interface NodesResponse {
  nodes: {
    root?: unknown;
    folder?: IsyFolder[];
    node?: IsyNode[];
    group?: IsyGroup[];
  };
}

/** Scene/Group as returned by /rest/nodes */
export interface IsyGroup {
  '@_flag': number;
  address: string;
  name: string;
  family?: number;
  parent?: { '@_type': number; '#text': string };
  members?: {
    link?: IsyGroupLink | IsyGroupLink[];
  };
}

/** Link within a scene/group */
export interface IsyGroupLink {
  '@_type': number;
  '#text': string;
}

/** Parsed /rest/status response */
export interface StatusResponse {
  nodes: {
    node?: StatusNode[];
  };
}

export interface StatusNode {
  '@_id': string;
  property?: IsyProperty | IsyProperty[];
}

/** Program summary from /rest/programs */
export interface IsyProgram {
  '@_id': string;
  '@_parentId': string;
  '@_status': string;
  '@_folder'?: string;
  '@_enabled': string;
  '@_running'?: string;
  '@_runAtStartup'?: string;
  name: string;
  lastRunTime?: string;
  lastFinishTime?: string;
  nextScheduledRunTime?: string;
}

/** D2D trigger (full program with conditions/actions) */
export interface D2DTrigger {
  id: number;
  name: string;
  parent: number;
  folder?: string;
  if?: string;
  then?: string;
  else?: string;
  comment?: string;
}

/** GetAllD2D response after parsing */
export interface D2DResponse {
  key: string;
  triggers: D2DTrigger[];
}

/** /rest/config response */
export interface ConfigResponse {
  configuration: {
    platform?: string;
    app_version?: string;
    app_full_version?: string;
    root?: { id?: string; name?: string };
    nodeServers?: unknown;
    features?: unknown;
  };
}

/** Error log entry */
export interface ErrorLogEntry {
  '@_time'?: string;
  '@_nr'?: string;
  '#text'?: string;
}

/** eisy event log entry (from /rest/log) */
export interface EisyLogEntry {
  /** Device/node address */
  '@_node'?: string;
  /** ISY control code (ST, DON, DOF, OL, RR, etc.) */
  '@_control'?: string;
  /** Action/value */
  '@_action'?: string | number;
  /** Timestamp (ISY format) */
  '@_time'?: string;
  /** User/task ID */
  '@_uid'?: string;
  /** Log type code */
  '@_type'?: string | number;
  /** Formatted value */
  '@_formatted'?: string;
  /** Text content (for plain-text log lines) */
  '#text'?: string;
}

/** Variable (integer or state) */
export interface IsyVariable {
  '@_type': number;
  '@_id': number;
  name?: string;
  val: number;
  init?: number;
  ts?: string;
}

/** Node notes (spoken names, location, description) from /rest/nodes/{addr}/notes */
export interface NodeNotes {
  spoken?: string;
  location?: string;
  description?: string;
  isLoad?: string | boolean;
}

/** WebSocket event types */
export type WsEventType = 'status' | 'program' | 'system' | 'error' | 'unknown';

export interface WsEvent {
  type: WsEventType;
  node?: string;
  control?: string;
  action?: string | number;
  formatted?: string;
  uom?: string;
  prec?: number;
  raw: string;
}

/** SOAP operation result */
export interface SoapResult {
  success: boolean;
  status: number;
  info?: string;
}

/** Command IDs used in REST and SOAP */
export const CMD = {
  DON: 'DON',
  DOF: 'DOF',
  DFON: 'DFON',
  DFOF: 'DFOF',
  LOCK: 'LOCK',
  UNLOCK: 'UNLOCK',
  FDUP: 'FDUP',
  FDDOWN: 'FDDOWN',
  FDSTOP: 'FDSTOP',
  QUERY: 'QUERY',
  BEEP: 'BEEP',
  BL: 'BL',
} as const;

/** SOAP service URNs — different operations use different services */
export const SOAP_SERVICE = {
  INSTEON: 'urn:udi-com:service:X_Insteon_Lighting_Service:1',
  IOX: 'urn:udi-com:service:X_IoX_Service:1',
} as const;

/** API path constants */
export const API = {
  REST_NODES: '/rest/nodes',
  REST_STATUS: '/rest/status',
  REST_PROGRAMS: '/rest/programs',
  REST_CONFIG: '/rest/config',
  REST_VARS_INT: '/rest/vars/get/1',
  REST_VARS_STATE: '/rest/vars/get/2',
  REST_LOG: '/rest/log',
  REST_ERROR_LOG: '/rest/log/error',
  REST_QUERY: '/rest/query',
  REST_SCENES: '/rest/nodes/scenes',
  REST_ZWAVE_INCLUDE: '/rest/zwave/node/include',
  REST_ZWAVE_EXCLUDE: '/rest/zwave/node/exclude',
  SERVICES: '/services',
  PROGRAM_UPLOAD: '/program/upload',
  PROGRAM_DELETE: '/program/delete',
  FILE_UPLOAD: '/file/upload',
  FILE_DELETE: '/file/delete',
  WS_SUBSCRIBE: '/rest/subscribe',
} as const;
