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
import { useLogStore } from '@/stores/log-store.ts';
import { useDeviceStore } from '@/stores/device-store.ts';

type WsListener = (event: WsEvent) => void;

interface WsState {
  ws: WebSocket | null;
  connected: boolean;
  reconnectAttempts: number;
  pollingInterval: ReturnType<typeof setInterval> | null;
  listeners: Set<WsListener>;
}

const state: WsState = {
  ws: null,
  connected: false,
  reconnectAttempts: 0,
  pollingInterval: null,
  listeners: new Set(),
};

const MAX_RECONNECT_DELAY = 30_000;
const POLL_INTERVAL = 5_000;

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

/** Parse an ISY WebSocket XML event into a typed WsEvent */
function parseWsEvent(xmlText: string): WsEvent | null {
  try {
    const parsed = parseXml(xmlText) as Record<string, unknown>;
    const event = (parsed['Event'] ?? parsed['event'] ?? parsed) as Record<string, unknown>;

    // Determine event type
    const control = String(event['control'] ?? '');
    let type: WsEventType = 'unknown';
    if (control === '_1' || control === 'ST' || control === 'DON' || control === 'DOF') {
      type = 'status';
    } else if (control === '_3') {
      type = 'program';
    } else if (control === '_5' || control === 'ERR') {
      type = 'error';
    } else if (control === '_0') {
      type = 'system';
    }

    // IMPORTANT: Always String() the node address — fast-xml-parser coerces numeric
    // addresses to JS numbers, but our store Maps use string keys.
    const rawNode = event['node'];
    const node = rawNode != null ? String(rawNode) : undefined;
    const action = event['action'] as string | number | undefined;
    const eventInfo = event['eventInfo'] as Record<string, unknown> | undefined;

    // Extract formatted value and UOM
    let formatted: string | undefined;
    let uom: string | undefined;
    let prec: number | undefined;

    if (eventInfo) {
      formatted = eventInfo['@_formatted'] as string | undefined;
      uom = String(eventInfo['@_uom'] ?? '');
      prec = eventInfo['@_prec'] as number | undefined;
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

      // Check if value actually changed before logging (skip unchanged/heartbeat updates)
      const oldProps = useStatusStore.getState().properties.get(String(node));
      const oldValue = oldProps?.get('ST');
      const newFormatted = formatted ?? String(action ?? '');
      const oldFormatted = oldValue?.['@_formatted'] ?? String(oldValue?.['@_value'] ?? '');
      const valueChanged = !oldValue || oldFormatted !== newFormatted;

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

      // Log meaningful status changes to the event log
      if (valueChanged && (control === 'DON' || control === 'DOF' || control === 'ST')) {
        const nodeInfo = useDeviceStore.getState().nodeMap.get(String(node));
        const deviceName = nodeInfo?.name ?? node;
        const actionDesc = control === 'DON'
          ? `turned On${formatted ? ` (${formatted})` : ''}`
          : control === 'DOF'
            ? 'turned Off'
            : `status changed to ${formatted ?? String(action ?? '')}`;

        useLogStore.getState().addEntry({
          category: 'command',
          device: node,
          deviceName,
          action: actionDesc,
          source: 'device',
          result: 'success',
        });
      }
    }

    // Log program events
    if (type === 'program' && node) {
      const actionStr = String(action ?? '');
      // Program events: action values represent program status changes
      // 0=idle, 1=then, 2=else, 3=running, etc.
      const statusMap: Record<string, string> = {
        '0': 'finished',
        '1': 'running THEN',
        '2': 'running ELSE',
        '3': 'started',
        '6': 'enabled',
        '7': 'disabled',
      };
      const programAction = statusMap[actionStr] ?? `state changed (${actionStr})`;

      useLogStore.getState().addEntry({
        category: 'program',
        device: node,
        deviceName: `Program ${node}`,
        action: programAction,
        source: 'system',
        result: 'success',
      });
    }

    // Log error events
    if (type === 'error') {
      useLogStore.getState().addEntry({
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

  // Close existing connection
  disconnectWebSocket();

  // Build WebSocket URL:
  // - Dev/proxy mode (host is empty): connect through Vite proxy at ws://localhost:5173/rest/subscribe
  //   Vite upgrades this to wss://eisy:8443/rest/subscribe, sidestepping self-signed cert issues.
  // - Production (host is set): connect directly to wss://eisy:port/rest/subscribe
  let wsUrl: string;
  if (config.host) {
    wsUrl = `wss://${config.host}:${config.port}/rest/subscribe`;
  } else {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${wsProtocol}//${window.location.host}/rest/subscribe`;
  }

  try {
    const ws = new WebSocket(wsUrl, 'ISYSUB');

    ws.onopen = () => {
      console.log('[WS] Connected');
      state.connected = true;
      state.reconnectAttempts = 0;
      stopPolling();

      // Send subscription authorization
      // Browser WS doesn't support custom headers, so encode auth in first message
      const authToken = btoa(`${config.username}:${config.password}`);
      ws.send(`<subscribe><authorization>Basic ${authToken}</authorization></subscribe>`);
    };

    ws.onmessage = (msg) => {
      const event = parseWsEvent(String(msg.data));
      if (event) notifyListeners(event);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      state.connected = false;
      state.ws = null;
      scheduleReconnect();
    };

    state.ws = ws;
  } catch (err) {
    console.error('[WS] Failed to connect:', err);
    startPolling();
  }
}

/** Disconnect from the WebSocket */
export function disconnectWebSocket(): void {
  if (state.ws) {
    state.ws.onclose = null; // prevent reconnect on intentional close
    state.ws.close();
    state.ws = null;
  }
  state.connected = false;
  stopPolling();
}

/** Reconnect with exponential backoff */
function scheduleReconnect(): void {
  const delay = Math.min(1000 * 2 ** state.reconnectAttempts, MAX_RECONNECT_DELAY);
  state.reconnectAttempts++;
  console.log(`[WS] Reconnecting in ${delay}ms (attempt ${state.reconnectAttempts})`);

  setTimeout(() => {
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
