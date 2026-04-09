/**
 * WebSocket subscription + auto-reconnect + polling fallback.
 *
 * Connects to wss://{host}:8443/rest/subscribe with protocol "ISYSUB".
 * Events are XML messages: node status changes, program state, system events.
 * Falls back to periodic REST polling if WebSocket fails.
 */
import { parseXml } from '@/utils/xml-parser.ts';
import { getConnectionConfig } from './client.ts';
import type { WsEvent, WsEventType, IsyProperty } from './types.ts';
import { useStatusStore } from '@/stores/status-store.ts';
import { useLogStore, type LogEntry } from '@/stores/log-store.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import { attributeSource, registerProgramExecution, getAttributionDetail } from '@/utils/source-attribution.ts';

type WsListener = (event: WsEvent) => void;

interface WsState {
  ws: WebSocket | null;
  connected: boolean;
  reconnectAttempts: number;
  pollingInterval: ReturnType<typeof setInterval> | null;
  listeners: Set<WsListener>;
  /** Whether we've already logged the polling-fallback transition (suppress repeats) */
  pollingLogged: boolean;
  /** Whether we've already logged the first WS failure (suppress repeated error logs) */
  failureLogged: boolean;
  /** Pending reconnect timer (so we can cancel on intentional disconnect) */
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const state: WsState = {
  ws: null,
  connected: false,
  reconnectAttempts: 0,
  pollingInterval: null,
  listeners: new Set(),
  pollingLogged: false,
  failureLogged: false,
  reconnectTimer: null,
};

const MAX_RECONNECT_DELAY = 30_000;
const POLL_INTERVAL = 5_000;

// Note: We no longer log ST events to IndexedDB — they're status reports, not
// commands. The eisy event log (eisy tab) captures ST events for detailed debugging.
// Only DON/DOF (actual state changes) are logged as 'command' category.

/** Subscribe to WebSocket events */
export function addWsListener(listener: WsListener): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

function notifyListeners(event: WsEvent): void {
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('[WS] Listener error:', err);
    }
  }
}

/**
 * Extract a scalar value from a fast-xml-parser result.
 * XML tags with attributes parse to objects: <action uom="25">28</action>
 * becomes { '@_uom': 25, '#text': 28 }. This function returns the text
 * content as a string/number, or undefined if the input is null/undefined.
 */
function extractValue(raw: unknown): string | number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'object') {
    // fast-xml-parser object: get the #text property
    const text = (raw as Record<string, unknown>)['#text'];
    return text != null ? (typeof text === 'number' ? text : String(text)) : undefined;
  }
  return raw as string | number;
}

/** Safely log to the event log — catch errors to prevent silent IndexedDB failures */
function safeLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
  useLogStore.getState().addEntry(entry).catch((err) => {
    console.error('[WS] Failed to write log entry:', err);
  });
}

/** Parse an ISY WebSocket XML event into a typed WsEvent */
function parseWsEvent(xmlText: string): WsEvent | null {
  try {
    const parsed = parseXml(xmlText) as Record<string, unknown>;
    const event = (parsed['Event'] ?? parsed['event'] ?? parsed) as Record<string, unknown>;

    // Determine event type from ISY control codes:
    //   _0  = Heartbeat / trigger event
    //   _1  = Device status (also direct ST/DON/DOF/OL/RR controls)
    //   _2  = Key change / button event
    //   _3  = Program event (state changes, conditions evaluating)
    //   _4  = System config change
    //   _5  = System status (busy/idle/safe-mode) — NOT an error
    //   _7  = Progress report
    //   ERR = Actual error
    const control = String(event['control'] ?? '');
    let type: WsEventType = 'unknown';
    if (control === '_1' || control === 'ST' || control === 'DON' || control === 'DOF') {
      type = 'status';
    } else if (control === '_3') {
      type = 'program';
    } else if (control === 'ERR') {
      type = 'error';
    } else if (control === '_0' || control === '_5' || control === '_4' || control === '_7') {
      type = 'system';
    }

    // IMPORTANT: Always String() the node address — fast-xml-parser coerces numeric
    // addresses to JS numbers, but our store Maps use string keys.
    const rawNode = event['node'];
    const node = rawNode != null ? String(rawNode) : undefined;

    // fast-xml-parser returns objects for XML tags with attributes, e.g.:
    //   <action uom="25">28</action> → { '@_uom': 25, '#text': 28 }
    // Use extractValue() to safely get the text content as a primitive.
    const rawAction = event['action'];
    const action = extractValue(rawAction);
    const rawEventInfo = event['eventInfo'] as Record<string, unknown> | undefined;

    // Extract formatted value, UOM, and precision from eventInfo.
    // eventInfo structure varies:
    //   Direct: <eventInfo formatted="On" uom="100">255</eventInfo>
    //   Nested: <eventInfo><value formatted="Off" uom="100">0</value></eventInfo>
    let formatted: string | undefined;
    let uom: string | undefined;
    let prec: number | undefined;

    if (rawEventInfo) {
      // Try direct attributes first, then nested <value> element
      const info = rawEventInfo['value'] as Record<string, unknown> | undefined;
      const fmtSource = info ?? rawEventInfo;
      const rawFormatted = fmtSource['@_formatted'];
      formatted = rawFormatted != null && typeof rawFormatted !== 'object'
        ? String(rawFormatted)
        : undefined;
      uom = String(fmtSource['@_uom'] ?? rawEventInfo['@_uom'] ?? '');
      prec = (fmtSource['@_prec'] ?? rawEventInfo['@_prec']) as number | undefined;
    }

    const wsEvent: WsEvent = {
      type,
      node: node ?? undefined,
      control: control || undefined,
      action: action ?? undefined,
      formatted,
      uom,
      prec,
      raw: xmlText,
    };

    // If it's a status event, update the status store directly
    if (type === 'status' && node && control) {
      const prop: IsyProperty = {
        '@_id': control,
        '@_value': action ?? '',
        '@_formatted': formatted,
        '@_uom': uom,
        '@_prec': prec,
      };

      // Store the raw event property (DON, DOF, ST, OL, RR, etc.)
      useStatusStore.getState().updateProperty(node, prop);

      // DON/DOF are command acknowledgments — also update the ST (Status)
      // property so the UI (which reads ST) reflects the new device state.
      if (control === 'DON' || control === 'DOF') {
        const stValue = control === 'DOF' ? 0 : (action ?? 255);
        const stProp: IsyProperty = {
          '@_id': 'ST',
          '@_value': stValue,
          '@_formatted': formatted ?? (control === 'DOF' ? 'Off' : String(stValue)),
          '@_uom': uom ?? '100',
          '@_prec': prec,
        };
        useStatusStore.getState().updateProperty(node, stProp);
      }

      // Log device commands to the event log.
      // DON/DOF: ALWAYS log — these represent actual device state changes
      //          (physical switch press, scene activation, program command,
      //          voice assistant, UDAC command, Super eisy UI, etc.)
      // ST:      NOT logged — these are status reports/heartbeats, not commands.
      //          The eisy's event buffer (eisy tab) captures ST events for debugging.
      if (control === 'DON' || control === 'DOF') {
        const nodeInfo = useDeviceStore.getState().nodeMap.get(String(node));
        const deviceName = nodeInfo?.name ?? node;

        // Build a descriptive action: convert byte value (0-255) to percentage for dimmers.
        // DOF = Turn Off. DON with value 255 = Turn On (100%). DON with 0 = Turn Off.
        // DON with intermediate value = Dim to N%.
        let actionDesc: string;
        if (control === 'DOF') {
          actionDesc = 'Turn Off';
        } else {
          const rawVal = typeof action === 'number' ? action : Number(action);
          if (isNaN(rawVal) || rawVal >= 255) {
            actionDesc = 'Turn On';
          } else if (rawVal === 0) {
            actionDesc = 'Turn Off';
          } else {
            const pct = Math.round((rawVal / 255) * 100);
            actionDesc = `Dim to ${pct}%`;
          }
        }

        // Attribute the source: was this caused by a program, scene, or physical switch?
        const source = attributeSource(String(node));
        const detail = getAttributionDetail(source);

        safeLog({
          category: 'command',
          device: node,
          deviceName,
          action: actionDesc,
          source,
          result: 'success',
          detail,
        });
      }
    }

    // Log program events (only meaningful state transitions, skip noisy evaluation states)
    if (type === 'program' && node) {
      const actionStr = String(action ?? '');
      // Program events: action values represent program state changes.
      // We log meaningful transitions (started, finished, running, enabled/disabled)
      // but skip noisy states like WH (While condition evaluating), FS/FE (folder start/end)
      // that fire constantly during normal operation.
      const loggableStatuses: Record<string, string> = {
        '0': 'finished',
        '1': 'running THEN',
        '2': 'running ELSE',
        '3': 'started',
        '4': 'stopped',
        '5': 'scheduled',
        '6': 'enabled',
        '7': 'disabled',
      };

      const programAction = loggableStatuses[actionStr];

      // Register program execution for source attribution
      if (actionStr === '1') registerProgramExecution(String(node), 'then');
      if (actionStr === '2') registerProgramExecution(String(node), 'else');

      if (programAction) {
        // Only log meaningful transitions — skip unknown/noisy codes
        const programInfo = useProgramStore.getState().getProgram(String(node));
        const programName = programInfo?.name ?? `Program ${node}`;

        safeLog({
          category: 'program',
          device: node,
          deviceName: programName,
          action: programAction,
          source: 'system',
          result: 'success',
        });
      }
    }

    // Log error events
    if (type === 'error') {
      safeLog({
        category: 'comms',
        device: node ?? undefined,
        deviceName: node ? (useDeviceStore.getState().nodeMap.get(String(node))?.name ?? node) : undefined,
        action: `Error: ${formatted ?? String(action ?? 'unknown')}`,
        source: 'system',
        result: 'fail',
        detail: xmlText,
      });
    }

    return wsEvent;
  } catch {
    return { type: 'unknown', raw: xmlText };
  }
}

/** Connect to the eisy WebSocket */
export function connectWebSocket(): void {
  const config = getConnectionConfig();

  // Close existing WebSocket socket WITHOUT stopping polling.
  // During reconnect attempts, polling should continue as fallback.
  // Polling is only stopped when the WebSocket actually connects (in onopen).
  if (state.ws) {
    state.ws.onclose = null; // prevent triggering reconnect from intentional close
    state.ws.onerror = null;
    state.ws.close();
    state.ws = null;
  }

  // Build WebSocket URL:
  // - Dev/proxy mode (host is empty): connect through Vite proxy at ws://localhost:5173/rest/subscribe
  //   Vite upgrades this to wss://eisy:8443/rest/subscribe, sidestepping self-signed cert issues.
  // - Production (host is set): connect directly to wss://eisy:port/rest/subscribe
  //
  // IMPORTANT: The eisy requires HTTP Basic Auth during the WebSocket upgrade handshake.
  // Browsers can't set custom headers on WebSocket connections, so we embed credentials
  // in the URL (wss://user:pass@host/path) which makes the browser include a Basic
  // authorization header during the HTTP upgrade. Without this, the eisy rejects the
  // connection before the handshake completes (error 1006).
  let wsUrl: string;
  if (config.host) {
    wsUrl = `wss://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/rest/subscribe`;
  } else {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port;
    const hostPort = port ? `${host}:${port}` : host;
    wsUrl = `${wsProtocol}//${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${hostPort}/rest/subscribe`;
  }

  try {
    const ws = new WebSocket(wsUrl, 'ISYSUB');

    ws.onopen = () => {
      console.log('[WS] Connected');
      state.connected = true;
      state.reconnectAttempts = 0;
      state.failureLogged = false;
      state.pollingLogged = false;
      stopPolling();

      // Log WebSocket connection to comms (strip credentials from URL for logging)
      const safeUrl = wsUrl.replace(/\/\/[^@]+@/, '//***@');
      safeLog({
        category: 'comms',
        action: 'WebSocket connected',
        source: 'system',
        result: 'success',
        detail: safeUrl,
      });

      // Note: Auth is handled via credentials in the URL (wss://user:pass@host/path).
      // The eisy authenticates during the HTTP upgrade handshake, so no post-connect
      // auth message is needed. The eisy responds with a SubscriptionResponse containing
      // the session ID (SID) automatically after successful connection.
    };

    ws.onmessage = (msg) => {
      const event = parseWsEvent(String(msg.data));
      if (event) notifyListeners(event);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
      // Only log the FIRST failure to avoid flooding the log with repeated errors.
      // Subsequent failures during the reconnect loop are suppressed until recovery.
      if (!state.failureLogged) {
        state.failureLogged = true;
        safeLog({
          category: 'comms',
          action: 'WebSocket error',
          source: 'system',
          result: 'fail',
        });
      }
    };

    ws.onclose = () => {
      const wasConnected = state.connected;
      state.connected = false;
      state.ws = null;

      // Only log disconnect if we were previously connected (real drop).
      // Don't log on failed reconnect attempts — that's just noise.
      if (wasConnected) {
        console.log('[WS] Disconnected');
        safeLog({
          category: 'comms',
          action: 'WebSocket disconnected',
          source: 'system',
          result: 'pending',
        });
      }

      scheduleReconnect();
    };

    state.ws = ws;
  } catch (err) {
    console.error('[WS] Failed to connect:', err);
    if (!state.failureLogged) {
      state.failureLogged = true;
      safeLog({
        category: 'comms',
        action: `WebSocket failed to connect: ${err instanceof Error ? err.message : 'unknown'}`,
        source: 'system',
        result: 'fail',
      });
    }
    startPolling();
  }
}

/** Disconnect from the WebSocket (intentional — stops everything) */
export function disconnectWebSocket(): void {
  // Cancel any pending reconnect timer
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.ws) {
    state.ws.onclose = null; // prevent reconnect on intentional close
    state.ws.onerror = null;
    state.ws.close();
    state.ws = null;
  }
  state.connected = false;
  state.reconnectAttempts = 0;
  state.failureLogged = false;
  state.pollingLogged = false;
  stopPolling();
}

/** Reconnect with exponential backoff */
function scheduleReconnect(): void {
  const delay = Math.min(1000 * 2 ** state.reconnectAttempts, MAX_RECONNECT_DELAY);
  state.reconnectAttempts++;

  // Log only on first few attempts + at milestone intervals to avoid noise
  if (state.reconnectAttempts <= 3 || state.reconnectAttempts % 10 === 0) {
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${state.reconnectAttempts})`);
  }

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (!state.connected) {
      connectWebSocket();
    }
  }, delay);

  // After a few failed WS attempts, start polling as fallback
  if (state.reconnectAttempts >= 3) {
    startPolling();
  }
}

/** Fallback: poll /rest/status periodically */
function startPolling(): void {
  if (state.pollingInterval) return;
  console.log('[WS] Starting polling fallback');

  // Only log the polling transition ONCE per failure episode.
  // The flag is reset when WebSocket reconnects successfully.
  if (!state.pollingLogged) {
    state.pollingLogged = true;
    safeLog({
      category: 'comms',
      action: 'Switched to REST polling fallback',
      source: 'system',
      result: 'pending',
    });
  }

  state.pollingInterval = setInterval(async () => {
    try {
      await useStatusStore.getState().fetchAll();
    } catch (err) {
      console.error('[WS] Polling error:', err);
    }
  }, POLL_INTERVAL);
}

function stopPolling(): void {
  if (state.pollingInterval) {
    clearInterval(state.pollingInterval);
    state.pollingInterval = null;
  }
}

/** Check if WebSocket is currently connected */
export function isWebSocketConnected(): boolean {
  return state.connected;
}
