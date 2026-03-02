/**
 * Portal API client — talks to my.isy.io for Google Home voice control.
 *
 * Completely separate from the eisy REST client (client.ts) because:
 *  - Different host (my.isy.io vs local eisy)
 *  - JSON responses instead of XML
 *  - Different auth (portal email/password Basic Auth)
 *
 * Every API call is automatically logged to the log store (category: 'portal').
 */
import type { ApiResponse } from './client.ts';
import { useLogStore } from '@/stores/log-store.ts';

// ─── Types ────────────────────────────────────────────────────

export interface PortalCredentials {
  email: string;
  basicAuth: string; // btoa(email + ':' + password)
  domain: string; // from /login response (via portal proxy)
  uuid: string; // eisy UUID from /rest/config root.id
}

export interface PortalSpokenNode {
  _id: string;
  uuid: string;
  address: string;
  name: string;
  category: 'scene' | 'std' | 'lock' | 'program' | 'statevar';
  spoken: string[]; // up to 5 spoken names
  room: string; // room _id reference
  userCat: 'scene' | 'light' | 'switch' | 'outlet' | 'lock' | 'fan' | 'openClose';
  domain: string;
  colorMfr: string | null;
  turnOnValue?: number;
  turnOffValue?: number;
}

export interface PortalRoom {
  _id: string;
  name: string;
  uuid: string;
  domain: string;
}

/** Fields sent when creating/updating a spoken entry */
export interface SpokenNodePayload {
  address: string;
  spoken: string;
  spoken2?: string;
  spoken3?: string;
  spoken4?: string;
  spoken5?: string;
  room?: string;
  category: string;
  userCat: string;
  uuid: string;
  domain: string;
  id?: string; // _id — required for updates
  turnon_value?: number;
  turnoff_value?: number;
  colorMfr?: string;
}

// ─── Constants ────────────────────────────────────────────────

/**
 * Portal API base path.
 * - Dev mode: Uses Vite proxy (/portal-api → my.isy.io/api) to bypass broken CORS preflight.
 * - Production: Tries https://my.isy.io/api directly; falls back to CORS error message.
 *   The ISY Portal OPTIONS handler returns 500, so preflight-required requests fail.
 *   Simple requests (no custom headers) might work if the portal sends ACAO: *.
 */
const PORTAL_BASE = import.meta.env.DEV ? '/portal-api' : 'https://my.isy.io/api';
const TIMEOUT_MS = 15_000;

// ─── Internal helpers ─────────────────────────────────────────

function logPortal(
  action: string,
  result: 'success' | 'fail',
  detail?: string,
  rawCommand?: string,
) {
  useLogStore.getState().addEntry({
    category: 'portal',
    action,
    source: 'portal',
    result,
    detail,
    rawCommand,
  });
}

async function portalFetch<T>(
  method: string,
  path: string,
  basicAuth: string | null,
  body?: unknown,
  contentType: 'json' | 'form' = 'json',
): Promise<ApiResponse<T>> {
  const url = `${PORTAL_BASE}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {};
    if (basicAuth) {
      headers['Authorization'] = `Basic ${basicAuth}`;
    }
    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      // Bypass browser HTTP cache — portal returns 304 with empty body
      // when the browser sends If-None-Match/If-Modified-Since through the proxy,
      // which causes spoken/room data to appear empty.
      cache: 'no-store',
    };

    if (body !== undefined) {
      if (contentType === 'form') {
        // Portal login endpoint requires form-encoded data
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        init.body = new URLSearchParams(body as Record<string, string>).toString();
      } else {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
    }

    const resp = await fetch(url, init);
    clearTimeout(timeoutId);

    const text = await resp.text();
    let data: T | null = null;
    try {
      data = text.trim() ? (JSON.parse(text) as T) : null;
    } catch {
      // not JSON — keep data null
    }

    if (!resp.ok) {
      return { ok: false, status: resp.status, data, error: text, raw: text };
    }
    return { ok: true, status: resp.status, data, raw: text };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    // In production, CORS preflight to my.isy.io fails (their OPTIONS returns 500).
    // Provide a clear explanation instead of a cryptic "Failed to fetch".
    if (import.meta.env.PROD && message.includes('fetch')) {
      return {
        ok: false,
        status: 0,
        data: null,
        error: 'Portal connection unavailable — the ISY Portal (my.isy.io) blocks browser CORS requests. Use the dev server (bun run dev) for voice control features.',
      };
    }
    return { ok: false, status: 0, data: null, error: message };
  }
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Portal login response structure.
 * The portal returns three top-level objects:
 * - account: ISY subscription/billing info
 * - user: login identity with domain ID and linked eisy UUID
 * - jwtCredentials: token-based auth (not used — we use Basic Auth for API calls)
 */
interface PortalLoginResponse {
  account: {
    _id: string;
    shortname: string;
    description: string;
    contactname: string;
    contactemail: string;
  };
  user: {
    _id: string;
    username: string;
    /** Account domain ID — required for all portal API queries */
    domain: string;
    domainadmin: boolean;
    /** The eisy UUID linked to this portal account (e.g., "00:21:b9:02:71:dd") */
    isy: string;
  };
  jwtCredentials?: unknown;
}

/** Authenticate with portal — returns user profile including domain ID */
export async function portalLogin(
  email: string,
  password: string,
): Promise<ApiResponse<PortalLoginResponse>> {
  const raw = `POST /portal-api/login (${email})`;
  // Login endpoint uses form body for auth — no Basic Auth header needed.
  // The Basic Auth header is for subsequent API calls after login.
  const resp = await portalFetch<PortalLoginResponse>(
    'POST',
    '/login',
    null, // no auth header for login endpoint
    { email, password },
    'form', // Portal login requires form-encoded data, not JSON
  );

  if (resp.ok) {
    logPortal('Portal login', 'success', `Authenticated as ${email}`, raw);
  } else {
    logPortal('Portal login', 'fail', resp.error ?? 'Unknown error', raw);
  }
  return resp;
}

/** Fetch all spoken entries for this eisy */
export async function portalFetchSpokens(
  creds: PortalCredentials,
): Promise<ApiResponse<PortalSpokenNode[]>> {
  const path = `/voice/google/spoken/nodes?uuid=${creds.uuid}&domain=${creds.domain}`;
  // Portal wraps the array in a { data: [...] } envelope
  const resp = await portalFetch<{ data: PortalSpokenNode[] }>('GET', path, creds.basicAuth);

  // Unwrap the envelope → return bare array to callers
  const unwrapped: ApiResponse<PortalSpokenNode[]> = {
    ...resp,
    data: Array.isArray(resp.data?.data) ? resp.data.data : [],
  };

  if (unwrapped.ok) {
    logPortal('Fetch spoken entries', 'success', `${unwrapped.data?.length ?? 0} entries loaded`, `GET ${path}`);
  } else {
    logPortal('Fetch spoken entries', 'fail', resp.error, `GET ${path}`);
  }
  return unwrapped;
}

/** Create a new spoken entry */
export async function portalCreateSpoken(
  creds: PortalCredentials,
  node: SpokenNodePayload,
): Promise<ApiResponse<PortalSpokenNode>> {
  const resp = await portalFetch<PortalSpokenNode>(
    'PUT',
    '/voice/google/spoken/node',
    creds.basicAuth,
    node,
  );

  if (resp.ok) {
    logPortal('Create spoken entry', 'success', `${node.spoken} (${node.address})`, `PUT /api/voice/google/spoken/node`);
  } else {
    logPortal('Create spoken entry', 'fail', resp.error, `PUT /api/voice/google/spoken/node`);
  }
  return resp;
}

/** Update an existing spoken entry */
export async function portalUpdateSpoken(
  creds: PortalCredentials,
  node: SpokenNodePayload,
): Promise<ApiResponse<PortalSpokenNode>> {
  const resp = await portalFetch<PortalSpokenNode>(
    'POST',
    '/voice/google/spoken/node',
    creds.basicAuth,
    node,
  );

  if (resp.ok) {
    logPortal('Update spoken entry', 'success', `${node.spoken} (${node.address})`, `POST /api/voice/google/spoken/node`);
  } else {
    logPortal('Update spoken entry', 'fail', resp.error, `POST /api/voice/google/spoken/node`);
  }
  return resp;
}

/** Delete a spoken entry */
export async function portalDeleteSpoken(
  creds: PortalCredentials,
  id: string,
): Promise<ApiResponse<unknown>> {
  const path = `/voice/google/spoken/node?id=${id}&uuid=${creds.uuid}&domain=${creds.domain}`;
  const resp = await portalFetch<unknown>('DELETE', path, creds.basicAuth);

  if (resp.ok) {
    logPortal('Delete spoken entry', 'success', `id=${id}`, `DELETE ${path}`);
  } else {
    logPortal('Delete spoken entry', 'fail', resp.error, `DELETE ${path}`);
  }
  return resp;
}

/** Fetch all rooms for this eisy */
export async function portalFetchRooms(
  creds: PortalCredentials,
): Promise<ApiResponse<PortalRoom[]>> {
  const path = `/voice/google/spoken/rooms?uuid=${creds.uuid}&domain=${creds.domain}`;
  // Portal wraps the array in a { data: [...] } envelope
  const resp = await portalFetch<{ data: PortalRoom[] }>('GET', path, creds.basicAuth);

  // Unwrap the envelope → return bare array to callers
  const unwrapped: ApiResponse<PortalRoom[]> = {
    ...resp,
    data: Array.isArray(resp.data?.data) ? resp.data.data : [],
  };

  if (unwrapped.ok) {
    logPortal('Fetch rooms', 'success', `${unwrapped.data?.length ?? 0} rooms loaded`, `GET ${path}`);
  } else {
    logPortal('Fetch rooms', 'fail', resp.error, `GET ${path}`);
  }
  return unwrapped;
}

/** Create a new room */
export async function portalCreateRoom(
  creds: PortalCredentials,
  name: string,
): Promise<ApiResponse<PortalRoom>> {
  const resp = await portalFetch<PortalRoom>(
    'PUT',
    '/voice/google/spoken/room',
    creds.basicAuth,
    { name, uuid: creds.uuid, domain: creds.domain },
  );

  if (resp.ok) {
    logPortal('Create room', 'success', name, `PUT /api/voice/google/spoken/room`);
  } else {
    logPortal('Create room', 'fail', resp.error, `PUT /api/voice/google/spoken/room`);
  }
  return resp;
}

/** Update an existing room */
export async function portalUpdateRoom(
  creds: PortalCredentials,
  id: string,
  name: string,
): Promise<ApiResponse<PortalRoom>> {
  const resp = await portalFetch<PortalRoom>(
    'POST',
    '/voice/google/spoken/room',
    creds.basicAuth,
    { id, name, uuid: creds.uuid, domain: creds.domain },
  );

  if (resp.ok) {
    logPortal('Update room', 'success', name, `POST /api/voice/google/spoken/room`);
  } else {
    logPortal('Update room', 'fail', resp.error, `POST /api/voice/google/spoken/room`);
  }
  return resp;
}

/** Delete a room */
export async function portalDeleteRoom(
  creds: PortalCredentials,
  id: string,
): Promise<ApiResponse<unknown>> {
  const path = `/voice/google/spoken/room?id=${id}&domain=${creds.domain}&uuid=${creds.uuid}`;
  const resp = await portalFetch<unknown>('DELETE', path, creds.basicAuth);

  if (resp.ok) {
    logPortal('Delete room', 'success', `id=${id}`, `DELETE ${path}`);
  } else {
    logPortal('Delete room', 'fail', resp.error, `DELETE ${path}`);
  }
  return resp;
}

/** Push all spoken entries to Google Home */
export async function portalSyncToGoogle(
  creds: PortalCredentials,
): Promise<ApiResponse<unknown>> {
  const resp = await portalFetch<unknown>(
    'POST',
    '/voice/google/spoken/nodes/sync',
    creds.basicAuth,
    { uuid: creds.uuid, domain: creds.domain },
  );

  if (resp.ok) {
    logPortal('Sync to Google Home', 'success', 'All entries pushed', `POST /api/voice/google/spoken/nodes/sync`);
  } else {
    logPortal('Sync to Google Home', 'fail', resp.error, `POST /api/voice/google/spoken/nodes/sync`);
  }
  return resp;
}

/** Delete all spoken entries (dangerous!) */
export async function portalDeleteAllSpokens(
  creds: PortalCredentials,
): Promise<ApiResponse<unknown>> {
  const path = `/voice/google/spoken/nodes/deleteall?uuid=${creds.uuid}&domain=${creds.domain}`;
  const resp = await portalFetch<unknown>('DELETE', path, creds.basicAuth);

  if (resp.ok) {
    logPortal('Delete all spoken entries', 'success', 'All entries removed', `DELETE ${path}`);
  } else {
    logPortal('Delete all spoken entries', 'fail', resp.error, `DELETE ${path}`);
  }
  return resp;
}
