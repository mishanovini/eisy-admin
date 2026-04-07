/**
 * Browser-side eisy port auto-discovery.
 *
 * Uses fetch() to probe known ports for the eisy REST API.
 * Used by the LoginScreen when a manual host is entered and the default port fails.
 *
 * Limitations:
 * - Self-signed HTTPS certs will cause fetch failures unless previously accepted
 * - Mixed-content rules may block HTTP probes from HTTPS pages
 */

// ─── Types ──────────────────────────────────────────────────────

export interface BrowserProbeResult {
  protocol: 'http' | 'https';
  port: number;
  status: 'ok' | 'auth_failed' | 'not_eisy' | 'timeout' | 'error';
  timeMs: number;
  error?: string;
}

export interface BrowserDiscoveryResult {
  port: number;
  protocol: 'http' | 'https';
  results: BrowserProbeResult[];
}

// ─── Port Lists ─────────────────────────────────────────────────

const KNOWN_PORTS = [8443, 8080, 443, 80];
const EXTENDED_PORTS = [3000, 5000, 8000, 8888, 9443];

// ─── Probe Logic ────────────────────────────────────────────────

async function probePort(
  host: string,
  port: number,
  protocol: 'http' | 'https',
  username: string,
  password: string,
  timeout: number,
): Promise<BrowserProbeResult> {
  const start = Date.now();
  const auth = btoa(`${username}:${password}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${protocol}://${host}:${port}/rest/config`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    });

    clearTimeout(timer);
    const timeMs = Date.now() - start;

    if (res.status === 401) {
      return { protocol, port, status: 'auth_failed', timeMs };
    }

    if (res.ok) {
      const text = await res.text();
      // eisy REST API returns XML with <configuration> root
      if (text.includes('<configuration') || text.includes('<nodes')) {
        return { protocol, port, status: 'ok', timeMs };
      }
      return { protocol, port, status: 'not_eisy', timeMs };
    }

    return { protocol, port, status: 'not_eisy', timeMs };
  } catch (err) {
    clearTimeout(timer);
    const timeMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('abort') || message.includes('AbortError')) {
      return { protocol, port, status: 'timeout', timeMs };
    }
    return { protocol, port, status: 'error', timeMs, error: message };
  }
}

// ─── Discovery ──────────────────────────────────────────────────

/**
 * Build ordered candidates, deduplicating and putting the preferred combo first.
 */
function buildCandidates(
  preferredPort?: number,
  preferredProtocol?: 'http' | 'https',
): Array<[protocol: 'http' | 'https', port: number]> {
  const seen = new Set<string>();
  const candidates: Array<[protocol: 'http' | 'https', port: number]> = [];

  const add = (protocol: 'http' | 'https', port: number): void => {
    const key = `${protocol}:${port}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push([protocol, port]);
    }
  };

  if (preferredPort != null) {
    if (preferredProtocol) {
      add(preferredProtocol, preferredPort);
      add(preferredProtocol === 'https' ? 'http' : 'https', preferredPort);
    } else {
      add('https', preferredPort);
      add('http', preferredPort);
    }
  }

  const allPorts = [...KNOWN_PORTS, ...EXTENDED_PORTS];
  for (const port of allPorts) {
    add('https', port);
    add('http', port);
  }

  return candidates;
}

/**
 * Discover the eisy REST API from the browser.
 *
 * Probes known ports sequentially (short-circuits on first success).
 * Returns null if no port responds.
 *
 * @param onProgress - Optional callback fired after each probe for live UI updates
 */
export async function discoverEisyBrowser(options: {
  host: string;
  username: string;
  password: string;
  preferredPort?: number;
  preferredProtocol?: 'http' | 'https';
  timeout?: number;
  onProgress?: (result: BrowserProbeResult) => void;
}): Promise<BrowserDiscoveryResult | null> {
  const { host, username, password, preferredPort, preferredProtocol, timeout = 3000, onProgress } = options;
  const candidates = buildCandidates(preferredPort, preferredProtocol);
  const results: BrowserProbeResult[] = [];

  for (const [protocol, port] of candidates) {
    const result = await probePort(host, port, protocol, username, password, timeout);
    results.push(result);
    onProgress?.(result);

    if (result.status === 'ok') {
      return { port, protocol, results };
    }
  }

  return null;
}
