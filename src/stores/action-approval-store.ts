/**
 * Action Approval Store — Promise-based approval gate for AI-initiated
 * device commands. Prevents any AI/self-healing/auto-fix system from
 * executing real-world device commands without explicit user approval.
 *
 * Architecture:
 *  - requestApproval() returns Promise<boolean> — blocks the caller
 *  - UI renders pending actions with Allow/Deny buttons
 *  - 60-second timeout auto-denies for safety
 *  - Promise resolver stored in the queue entry
 */
import { create } from 'zustand';

// ─── Types ───────────────────────────────────────────────────

export interface PendingAction {
  id: string;
  description: string;
  detail: string;
  source: 'ai-chat' | 'self-healing' | 'auto-troubleshoot';
  deviceName?: string;
  timestamp: number;
  /** Internal — resolves the caller's Promise<boolean> */
  resolve: (approved: boolean) => void;
}

interface ActionApprovalState {
  pendingActions: PendingAction[];
  /** Add a new pending action to the queue */
  addPending: (action: Omit<PendingAction, 'id' | 'timestamp'>) => string;
  /** Approve an action — resolves its promise with `true` */
  approve: (id: string) => void;
  /** Deny an action — resolves its promise with `false` */
  deny: (id: string) => void;
  /** Deny all pending actions */
  denyAll: () => void;
}

// ─── Constants ───────────────────────────────────────────────

const APPROVAL_TIMEOUT_MS = 60_000; // 60 seconds

/** Monotonic counter for unique IDs */
let actionCounter = 0;

/** Active timeout handles so we can clean them up */
const timeoutMap = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Store ───────────────────────────────────────────────────

export const useActionApprovalStore = create<ActionApprovalState>((set, get) => ({
  pendingActions: [],

  addPending: (action) => {
    const id = `approval_${Date.now()}_${++actionCounter}`;
    const entry: PendingAction = {
      ...action,
      id,
      timestamp: Date.now(),
    };

    set((s) => ({ pendingActions: [...s.pendingActions, entry] }));

    // Auto-deny after timeout (safe default)
    const timer = setTimeout(() => {
      const state = get();
      const pending = state.pendingActions.find((a) => a.id === id);
      if (pending) {
        pending.resolve(false);
        set((s) => ({ pendingActions: s.pendingActions.filter((a) => a.id !== id) }));
      }
      timeoutMap.delete(id);
    }, APPROVAL_TIMEOUT_MS);

    timeoutMap.set(id, timer);

    return id;
  },

  approve: (id) => {
    const state = get();
    const action = state.pendingActions.find((a) => a.id === id);
    if (!action) return;

    // Clear timeout
    const timer = timeoutMap.get(id);
    if (timer) {
      clearTimeout(timer);
      timeoutMap.delete(id);
    }

    // Resolve promise with true (approved)
    action.resolve(true);
    set((s) => ({ pendingActions: s.pendingActions.filter((a) => a.id !== id) }));
  },

  deny: (id) => {
    const state = get();
    const action = state.pendingActions.find((a) => a.id === id);
    if (!action) return;

    // Clear timeout
    const timer = timeoutMap.get(id);
    if (timer) {
      clearTimeout(timer);
      timeoutMap.delete(id);
    }

    // Resolve promise with false (denied)
    action.resolve(false);
    set((s) => ({ pendingActions: s.pendingActions.filter((a) => a.id !== id) }));
  },

  denyAll: () => {
    const state = get();
    for (const action of state.pendingActions) {
      action.resolve(false);
      const timer = timeoutMap.get(action.id);
      if (timer) {
        clearTimeout(timer);
        timeoutMap.delete(action.id);
      }
    }
    set({ pendingActions: [] });
  },
}));

// ─── Standalone Approval Request ─────────────────────────────
//
// Callable from ANY module (tools.ts, self-healing.ts, kb-capture.ts)
// without needing React context. Returns a Promise that resolves
// when the user clicks Allow/Deny or the timeout expires.

export function requestApproval(opts: {
  description: string;
  detail: string;
  source: PendingAction['source'];
  deviceName?: string;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useActionApprovalStore.getState().addPending({
      ...opts,
      resolve,
    });
  });
}
