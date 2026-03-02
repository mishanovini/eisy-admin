/**
 * KB Capture detection hook — push-architecture event wiring for
 * automatic Knowledge Base population and error troubleshooting.
 *
 * Push channels (event-driven, no polling):
 *  1. New device detection — Zustand subscribe on device store load transitions
 *  2. Self-healing capture — Zustand subscribe on incident resolution
 *  3. AI proactive capture — handled in system prompt (no hook needed)
 *
 * Background scanning (low-priority, scheduled):
 *  4. Error pattern scan — requestIdleCallback at launch, then 1-hour interval
 *
 * Mounted in AppShell. Handles its own subscriptions and cleanup.
 */
import { useEffect, useRef } from 'react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useSelfHealingStore, type Incident } from '@/ai/self-healing.ts';
import { useLogStore } from '@/stores/log-store.ts';
import { useKBCaptureStore } from '@/stores/kb-capture-store.ts';
import {
  captureNewDevice,
  captureResolvedIncident,
  detectErrorPatterns,
} from '@/ai/kb-capture.ts';

/** How often to re-scan logs for error patterns (1 hour) */
const ERROR_SCAN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Schedule a low-priority background task using requestIdleCallback.
 * Falls back to setTimeout(fn, 2000) if requestIdleCallback is unavailable.
 *
 * requestIdleCallback tells the browser: "run this when you have nothing
 * else to do" — perfect for background scans that shouldn't interfere
 * with user interactions.
 */
function scheduleIdle(fn: () => void): number {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(() => fn(), { timeout: 10_000 });
  }
  // Fallback for environments without requestIdleCallback
  return window.setTimeout(fn, 2000);
}

function cancelIdle(id: number): void {
  if (typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(id);
  } else {
    clearTimeout(id);
  }
}

/**
 * Hook that activates KB capture channels (push-driven).
 * Call once in AppShell — handles its own subscriptions and cleanup.
 */
export function useKBCapture(): void {
  const hasInitialized = useRef(false);
  const hourlyScanRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleCallbackRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    // ── Channel 1: New Device Detection (push) ────────────
    // Subscribes to device store — fires when `loading` transitions true→false.
    // First load: seed known device set. Subsequent: diff for new devices.
    const unsubDevices = useDeviceStore.subscribe((state, prev) => {
      if (prev.loading && !state.loading) {
        const currentAddresses = new Set(state.nodes.map((n) => String(n.address)));
        const captureStore = useKBCaptureStore.getState();

        if (!hasInitialized.current) {
          hasInitialized.current = true;
          captureStore.setKnownDevices([...currentAddresses]);
          console.log(`[KB Capture] Initialized with ${currentAddresses.size} known devices`);
          return;
        }

        // Diff for new devices
        const knownSet = new Set(captureStore.knownDeviceAddresses);
        const newAddresses = [...currentAddresses].filter((addr) => !knownSet.has(addr));

        if (newAddresses.length > 0) {
          console.log(`[KB Capture] Detected ${newAddresses.length} new device(s)`);
          for (const addr of newAddresses) {
            const node = state.nodeMap.get(addr);
            if (node) {
              void captureNewDevice(node, state.nodeMap);
            }
          }
        }

        captureStore.setKnownDevices([...currentAddresses]);
      }
    });
    unsubscribers.push(unsubDevices);

    // ── Channel 2: Self-Healing Capture (push) ────────────
    // Fires when an incident transitions to 'resolved'.
    let previousIncidents: Incident[] = [];
    const unsubHealing = useSelfHealingStore.subscribe((state) => {
      const resolved = state.incidents.filter((inc) => inc.status === 'resolved');
      const newResolved = resolved.filter(
        (inc) => !previousIncidents.some((prev) => prev.id === inc.id && prev.status === 'resolved'),
      );

      for (const incident of newResolved) {
        void captureResolvedIncident(incident);
      }

      previousIncidents = state.incidents;
    });
    unsubscribers.push(unsubHealing);

    // ── Channel 3: AI Proactive Capture ───────────────────
    // No subscription needed — the AI calls captureKnowledge() directly
    // when it learns something valuable, via system prompt instructions.

    // ── Channel 4: Error Pattern Scan (background, low-priority) ──
    // Launch scan: runs via requestIdleCallback once app is idle after startup.
    // Hourly scan: 1-hour interval for ongoing monitoring.

    const runErrorScan = () => {
      const captureStore = useKBCaptureStore.getState();
      if (!captureStore.settings.enabled || !captureStore.settings.captureErrorPatterns) return;

      const entries = useLogStore.getState().entries;
      if (entries.length > 0) {
        void detectErrorPatterns(entries);
      }
    };

    // Launch scan — wait for app to settle, then scan in idle time
    idleCallbackRef.current = scheduleIdle(() => {
      const captureStore = useKBCaptureStore.getState();
      if (!captureStore.initialScanDone) {
        console.log('[KB Capture] Running initial error pattern scan...');
        captureStore.setInitialScanDone();
        runErrorScan();
      }
    });

    // Hourly scan
    hourlyScanRef.current = setInterval(() => {
      // Use requestIdleCallback so it doesn't interrupt user activity
      scheduleIdle(runErrorScan);
    }, ERROR_SCAN_INTERVAL_MS);

    // Cleanup
    return () => {
      for (const unsub of unsubscribers) unsub();
      if (hourlyScanRef.current) clearInterval(hourlyScanRef.current);
      if (idleCallbackRef.current != null) cancelIdle(idleCallbackRef.current);
    };
  }, []);
}
