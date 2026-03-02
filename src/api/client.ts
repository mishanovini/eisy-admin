import { parseXml } from '@/utils/xml-parser.ts';

/** Connection credentials stored in connection-store */
export interface ConnectionConfig {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  username: string;
  password: string;
}

/** Default config targeting local eisy via Vite proxy (dev) or same-origin (prod) */
let currentConfig: ConnectionConfig = {
  host: '',
  port: 0,
  protocol: 'https',
  username: 'admin',
  password: 'admin',
};

/** Update the active connection config (called from connection-store) */
export function setConnectionConfig(config: ConnectionConfig): void {
  currentConfig = config;
}

export function getConnectionConfig(): ConnectionConfig {
  return currentConfig;
}

/**
 * Build the base URL for API requests.
 * In dev mode (Vite proxy), paths like /rest/* are proxied to the eisy.
 * In production (deployed on eisy), requests go to same-origin.
 * If host is explicitly set, build an absolute URL for direct access.
 */
function baseUrl(): string {
  if (!currentConfig.host) return '';
  return `${currentConfig.protocol}://${currentConfig.host}:${currentConfig.port}`;
}

/** Build Basic Auth header value */
function authHeader(): string {
  return 'Basic ' + btoa(`${currentConfig.username}:${currentConfig.password}`);
}

/** Standard headers for all REST/SOAP requests */
function defaultHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: authHeader(),
  };
  if (extra) Object.assign(headers, extra);
  return headers;
}

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  raw?: string;
}

/**
 * GET request to an eisy REST endpoint.
 * Parses XML response into a typed JS object.
 */
export async function restGet<T = unknown>(
  path: string,
  options?: { timeout?: number },
): Promise<ApiResponse<T>> {
  const url = baseUrl() + path;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? 15_000);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: defaultHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await resp.text();

    if (!resp.ok) {
      return { ok: false, status: resp.status, data: null, error: text, raw: text };
    }

    const data = parseXml(text) as T;
    return { ok: true, status: resp.status, data, raw: text };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: null, error: message };
  }
}

/**
 * POST raw body to an eisy endpoint (used for program upload, file upload).
 */
export async function restPost(
  path: string,
  body: string,
  contentType = 'text/xml',
): Promise<ApiResponse<unknown>> {
  const url = baseUrl() + path;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: defaultHeaders({ 'Content-Type': contentType }),
      body,
    });
    const text = await resp.text();

    if (!resp.ok) {
      return { ok: false, status: resp.status, data: null, error: text, raw: text };
    }

    const data = text.trim() ? parseXml(text) : null;
    return { ok: true, status: resp.status, data, raw: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: null, error: message };
  }
}

/**
 * Send a SOAP request to /services.
 * Builds the SOAP envelope, sets the correct SOAPACTION header.
 */
export async function soapCall<T = unknown>(
  action: string,
  serviceUrn: string,
  innerXml: string,
): Promise<ApiResponse<T>> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${serviceUrn}">
      ${innerXml}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

  const url = baseUrl() + '/services';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: defaultHeaders({
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPACTION: `"${serviceUrn}#${action}"`,
      }),
      body: envelope,
    });
    const text = await resp.text();

    if (!resp.ok) {
      return { ok: false, status: resp.status, data: null, error: text, raw: text };
    }

    const data = text.trim() ? (parseXml(text) as T) : (null as T);
    return { ok: true, status: resp.status, data, raw: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: null, error: message };
  }
}

/**
 * Quick connectivity check — hits /rest/config and returns true if 200.
 */
export async function testConnection(): Promise<boolean> {
  const result = await restGet('/rest/config', { timeout: 5000 });
  return result.ok;
}
