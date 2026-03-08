/**
 * Scene write queue — non-blocking sequential processing of scene
 * property changes (on-level, ramp-rate) with toast notifications.
 *
 * Architecture:
 * - UI pushes write operations via enqueue() and updates optimistically
 * - Store processes one SOAP call at a time (eisy writes to physical devices)
 * - Coalescing: a new write for the same member+property replaces a pending one
 * - Toast state is driven from the entries array (SceneWriteToast reads it)
 *
 * The eisy sends SOAP commands to individual Insteon devices over the powerline/RF
 * mesh, so operations must be sequential. But the user shouldn't have to wait —
 * they can adjust multiple devices and the queue handles the rest.
 */
import { create } from 'zustand';
import { setSceneOnLevel, setSceneRampRate } from '@/api/soap.ts';
import { formatOnLevel, formatRampRate } from '@/utils/scene-utils.ts';
import { useLogStore } from '@/stores/log-store.ts';

export type SceneWriteProp = 'onLevel' | 'rampRate';

export type SceneWriteStatus = 'pending' | 'writing' | 'success' | 'error';

export interface SceneWriteEntry {
  /** Unique ID for this write operation */
  id: string;
  /** Member device address */
  memberAddr: string;
  /** Member device display name */
  memberName: string;
  /** Scene address */
  sceneAddr: string;
  /** Scene display name */
  sceneName: string;
  /** Which property is being written */
  prop: SceneWriteProp;
  /** The target value (0-255 for OL, 0-31 for RR) */
  value: number;
  /** Human-readable description of the value */
  valueLabel: string;
  /** Current status */
  status: SceneWriteStatus;
  /** Error message if status === 'error' */
  error?: string;
  /** Timestamp when enqueued */
  timestamp: number;
}

interface SceneWriteState {
  /** All write entries (pending, writing, recently completed) */
  entries: SceneWriteEntry[];
  /** Whether the processor is currently running */
  processing: boolean;

  /** Enqueue a write operation. Coalesces with pending entries for the same member+prop. */
  enqueue: (
    memberAddr: string,
    memberName: string,
    sceneAddr: string,
    sceneName: string,
    prop: SceneWriteProp,
    value: number,
  ) => void;

  /** Dismiss a completed/errored entry from the toast list */
  dismiss: (id: string) => void;
}

let idCounter = 0;
function nextId(): string {
  return `sw-${++idCounter}-${Date.now()}`;
}

function valueLabel(prop: SceneWriteProp, value: number): string {
  if (prop === 'onLevel') return formatOnLevel(value);
  return formatRampRate(value);
}

function propLabel(prop: SceneWriteProp): string {
  return prop === 'onLevel' ? 'On Level' : 'Ramp Rate';
}

export const useSceneWriteStore = create<SceneWriteState>((set) => ({
  entries: [],
  processing: false,

  enqueue: (memberAddr, memberName, sceneAddr, sceneName, prop, value) => {
    set((state) => {
      const entries = [...state.entries];

      // Coalesce: if there's already a pending entry for same member+prop+scene, replace it
      const pendingIdx = entries.findIndex(
        (e) =>
          e.status === 'pending' &&
          e.memberAddr === memberAddr &&
          e.sceneAddr === sceneAddr &&
          e.prop === prop,
      );

      if (pendingIdx !== -1) {
        entries[pendingIdx] = {
          ...entries[pendingIdx]!,
          value,
          valueLabel: valueLabel(prop, value),
          timestamp: Date.now(),
        };
      } else {
        entries.push({
          id: nextId(),
          memberAddr,
          memberName,
          sceneAddr,
          sceneName,
          prop,
          value,
          valueLabel: valueLabel(prop, value),
          status: 'pending',
          timestamp: Date.now(),
        });
      }

      return { entries };
    });

    // Kick off processing if not already running
    processQueue();
  },

  dismiss: (id) => {
    set((state) => ({
      entries: state.entries.filter((e) => e.id !== id),
    }));
  },
}));

// ─── Persistent Logging ─────────────────────────────────────

/** Log a completed scene write to IndexedDB for long-term analysis */
function logWriteResult(entry: SceneWriteEntry) {
  const succeeded = entry.status === 'success';
  useLogStore.getState().addEntry({
    category: 'scene',
    device: entry.memberAddr,
    deviceName: entry.memberName,
    action: `Set ${propLabel(entry.prop)} → ${entry.valueLabel}`,
    source: `scene:${entry.sceneAddr}`,
    result: succeeded ? 'success' : 'fail',
    detail: succeeded
      ? `in ${entry.sceneName}`
      : `in ${entry.sceneName} — ${entry.error ?? 'Write failed'}`,
    rawCommand: `SOAP DeviceSpecific ${entry.prop === 'onLevel' ? 'S_OL_SP' : 'S_RR_SP'} node=${entry.memberAddr} scene=${entry.sceneAddr} value=${entry.value}`,
  });
}

// ─── Queue Processor ─────────────────────────────────────────

async function processQueue() {
  const store = useSceneWriteStore;

  if (store.getState().processing) return; // already running
  store.setState({ processing: true });

  while (true) {
    const { entries } = store.getState();
    const next = entries.find((e) => e.status === 'pending');
    if (!next) break; // queue drained

    // Mark as writing
    store.setState({
      entries: store.getState().entries.map((e) =>
        e.id === next.id ? { ...e, status: 'writing' as const } : e,
      ),
    });

    // Execute the SOAP call
    try {
      const result =
        next.prop === 'onLevel'
          ? await setSceneOnLevel(next.memberAddr, next.sceneAddr, next.value)
          : await setSceneRampRate(next.memberAddr, next.sceneAddr, next.value);

      const updatedStatus = (result.success ? 'success' : 'error') as SceneWriteStatus;
      const updatedError = result.success ? undefined : (result.info ?? 'Write failed');

      store.setState({
        entries: store.getState().entries.map((e) =>
          e.id === next.id
            ? { ...e, status: updatedStatus, error: updatedError }
            : e,
        ),
      });

      // Persist to IndexedDB log
      logWriteResult({ ...next, status: updatedStatus, error: updatedError });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Write failed';

      store.setState({
        entries: store.getState().entries.map((e) =>
          e.id === next.id
            ? { ...e, status: 'error' as const, error: errorMsg }
            : e,
        ),
      });

      // Persist to IndexedDB log
      logWriteResult({ ...next, status: 'error', error: errorMsg });
    }

    // Auto-dismiss successful entries after 3 seconds
    if (store.getState().entries.find((e) => e.id === next.id)?.status === 'success') {
      setTimeout(() => {
        store.getState().dismiss(next.id);
      }, 3000);
    }
  }

  store.setState({ processing: false });
}

// ─── Helpers for external consumers ──────────────────────────

/** Build a human-readable description of a write entry */
export function describeWrite(entry: SceneWriteEntry): string {
  return `${propLabel(entry.prop)} → ${entry.valueLabel}`;
}
