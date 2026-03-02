/**
 * WebSocket connection hook.
 * Manages WebSocket lifecycle tied to connection state.
 */
import { useEffect, useRef } from 'react';
import { useConnectionStore } from '@/stores/connection-store.ts';
import { connectWebSocket, disconnectWebSocket, addWsListener, isWebSocketConnected } from '@/api/websocket.ts';
import type { WsEvent } from '@/api/types.ts';

/** Connect WebSocket when authenticated, disconnect on unmount */
export function useWebSocket(onEvent?: (event: WsEvent) => void): { connected: boolean } {
  const status = useConnectionStore((s) => s.status);
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (status !== 'connected') return;

    connectWebSocket();

    const unsubscribe = addWsListener((event) => {
      callbackRef.current?.(event);
    });

    return () => {
      unsubscribe();
      disconnectWebSocket();
    };
  }, [status]);

  return { connected: isWebSocketConnected() };
}
