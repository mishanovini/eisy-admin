/**
 * Self-healing pipeline — monitors device commands for errors and uses AI
 * to diagnose and fix issues automatically.
 *
 * Architecture:
 *  - Incident state machine: detected -> diagnosing -> fixing -> resolved | failed
 *  - Zustand store for incident tracking and StatusBar integration
 *  - Callback-based AI diagnosis (avoids circular deps with provider.ts)
 *  - Per-device cooldown + retry limits to prevent infinite loops
 */
import { create } from 'zustand';
import { queryNode, sendNodeCommand } from '@/api/rest.ts';
import { useLogStore } from '@/stores/log-store.ts';
import { requestApproval } from '@/stores/action-approval-store.ts';

// ─── Types ───────────────────────────────────────────────────

export interface Incident {
  id: string;
  deviceAddress: string;
  deviceName: string;
  command: string;
  error: string;
  status: 'detected' | 'diagnosing' | 'fixing' | 'resolved' | 'failed';
  attempts: number;
  diagnosis?: string;
  resolution?: string;
  timestamp: number;
}

interface SelfHealingState {
  incidents: Incident[];
  activeIncident: Incident | null;
  enabled: boolean;

  /** Report an error for self-healing */
  reportError: (deviceAddress: string, deviceName: string, command: string, error: string) => void;
  /** Process the next incident in queue */
  processNext: () => Promise<void>;
  /** Toggle self-healing on/off */
  setEnabled: (enabled: boolean) => void;
  /** Clear resolved incidents */
  clearResolved: () => void;
  /** Get recent incidents for display */
  getRecent: (count?: number) => Incident[];
}

// ─── Constants ───────────────────────────────────────────────

const MAX_RETRIES = 3;
const COOLDOWN_MS = 60_000; // 60 seconds per device

// ─── Module-level state ──────────────────────────────────────

/** Cooldown tracker: deviceAddress -> last incident timestamp */
const cooldownMap = new Map<string, number>();

/** Registered AI diagnoser callback (set by app startup to avoid circular deps) */
let aiDiagnoser: ((prompt: string) => Promise<string>) | null = null;

/** Monotonic incident counter for ID generation */
let incidentCounter = 0;

function nextIncidentId(): string {
  return `inc_${Date.now()}_${++incidentCounter}`;
}

// ─── AI Diagnoser Registration ───────────────────────────────

/**
 * Register the AI diagnosis function. Called once at app startup.
 * This avoids a circular dependency with provider.ts — the caller
 * passes in `sendChatMessage` (or a wrapper) so this module never
 * imports it directly.
 */
export function registerAIDiagnoser(fn: (prompt: string) => Promise<string>): void {
  aiDiagnoser = fn;
}

// ─── Diagnostic Prompt Builder ───────────────────────────────

function buildDiagnosticPrompt(incident: Incident): string {
  return `A device command failed and needs diagnosis.
Device: ${incident.deviceName} (${incident.deviceAddress})
Command attempted: ${incident.command}
Error: ${incident.error}

Please diagnose the issue and suggest a fix. Common fixes include:
- Re-querying the device (communication timeout)
- Clearing the error state
- Writing pending device updates
- Checking if the device is battery-powered and needs to be woken up

Respond with a brief diagnosis and recommended action.`;
}

// ─── Response Parser ─────────────────────────────────────────

interface ParsedAction {
  type: 'query' | 'command' | 'none';
  command?: string;
  value?: number;
}

/**
 * Parse the AI diagnosis response for an actionable fix.
 * Looks for keywords that map to known recovery actions.
 */
function parseAIResponse(response: string): ParsedAction {
  const lower = response.toLowerCase();

  // Check for re-query suggestion
  if (lower.includes('re-query') || lower.includes('requery') || lower.includes('query the device') || lower.includes('query device') || lower.includes('communication timeout')) {
    return { type: 'query' };
  }

  // Check for specific command suggestions
  if (lower.includes('turn off') || lower.includes('send dof')) {
    return { type: 'command', command: 'DOF' };
  }
  if (lower.includes('turn on') || lower.includes('send don')) {
    return { type: 'command', command: 'DON' };
  }

  // Check for error clearing / write updates
  if (lower.includes('clear') || lower.includes('reset') || lower.includes('write') || lower.includes('update')) {
    return { type: 'query' }; // A query is the safest generic recovery action
  }

  // No actionable fix recognized
  return { type: 'none' };
}

// ─── Logging Helper ──────────────────────────────────────────

function logIncident(incident: Incident, action: string, result: 'success' | 'fail'): void {
  useLogStore.getState().addEntry({
    category: 'comms',
    device: incident.deviceAddress,
    deviceName: incident.deviceName,
    action,
    source: 'self-healing',
    result,
    detail: incident.diagnosis ?? incident.error,
  });
}

// ─── Store ───────────────────────────────────────────────────

export const useSelfHealingStore = create<SelfHealingState>((set, get) => ({
  incidents: [],
  activeIncident: null,
  enabled: true,

  reportError: (deviceAddress, deviceName, command, error) => {
    const state = get();
    if (!state.enabled) return;

    // Check cooldown — don't re-heal the same device within COOLDOWN_MS
    const lastTime = cooldownMap.get(deviceAddress);
    if (lastTime && Date.now() - lastTime < COOLDOWN_MS) {
      return;
    }

    // Check if there's already an active (non-terminal) incident for this device
    const hasActive = state.incidents.some(
      (inc) =>
        inc.deviceAddress === deviceAddress &&
        (inc.status === 'detected' || inc.status === 'diagnosing' || inc.status === 'fixing'),
    );
    if (hasActive) return;

    // Record the cooldown timestamp
    cooldownMap.set(deviceAddress, Date.now());

    const incident: Incident = {
      id: nextIncidentId(),
      deviceAddress,
      deviceName,
      command,
      error,
      status: 'detected',
      attempts: 0,
      timestamp: Date.now(),
    };

    set((s) => ({ incidents: [incident, ...s.incidents] }));

    logIncident(incident, `Error detected: ${command} failed`, 'fail');

    // Auto-process if no active incident
    if (!state.activeIncident) {
      // Use void to explicitly discard the promise (fire-and-forget)
      void get().processNext();
    }
  },

  processNext: async () => {
    const state = get();

    // Guard: don't process if already working on something
    if (state.activeIncident) return;

    // Find the first detected incident
    const target = state.incidents.find((inc) => inc.status === 'detected');
    if (!target) return;

    // Transition: detected -> diagnosing
    const diagnosing: Incident = { ...target, status: 'diagnosing' };
    set((s) => ({
      activeIncident: diagnosing,
      incidents: s.incidents.map((inc) => (inc.id === target.id ? diagnosing : inc)),
    }));

    try {
      // ── Step 1: AI Diagnosis ──
      let diagnosis = 'No AI diagnoser registered — attempting default recovery (re-query).';
      if (aiDiagnoser) {
        const prompt = buildDiagnosticPrompt(diagnosing);
        try {
          diagnosis = await aiDiagnoser(prompt);
        } catch {
          diagnosis = 'AI diagnosis unavailable — attempting default recovery (re-query).';
        }
      }

      const diagnosed: Incident = { ...diagnosing, diagnosis };
      set((s) => ({
        activeIncident: diagnosed,
        incidents: s.incidents.map((inc) => (inc.id === target.id ? diagnosed : inc)),
      }));

      // ── Step 2: Parse & Execute Fix ──
      const action = parseAIResponse(diagnosis);

      // Transition: diagnosing -> fixing
      const fixing: Incident = { ...diagnosed, status: 'fixing', attempts: diagnosed.attempts + 1 };
      set((s) => ({
        activeIncident: fixing,
        incidents: s.incidents.map((inc) => (inc.id === target.id ? fixing : inc)),
      }));

      let fixSucceeded = false;

      // ── Approval Gate — user must approve before any device command ──
      if (action.type !== 'none') {
        const actionDesc = action.type === 'query'
          ? `Re-query ${fixing.deviceName}`
          : `Send ${action.command} to ${fixing.deviceName}`;
        const actionDetail = action.type === 'query'
          ? `queryNode('${fixing.deviceAddress}')`
          : `sendNodeCommand('${fixing.deviceAddress}', '${action.command}'${action.value != null ? `, ${action.value}` : ''})`;

        const approved = await requestApproval({
          description: `Self-healing: ${actionDesc}`,
          detail: actionDetail,
          source: 'self-healing',
          deviceName: fixing.deviceName,
        });

        if (!approved) {
          // User denied — mark as failed immediately
          const denied: Incident = {
            ...fixing,
            status: 'failed',
            resolution: 'Fix denied by user.',
          };
          set((s) => ({
            activeIncident: null,
            incidents: s.incidents.map((inc) => (inc.id === target.id ? denied : inc)),
          }));
          logIncident(denied, 'Self-healing action denied by user', 'fail');
          return;
        }
      }

      switch (action.type) {
        case 'query': {
          fixSucceeded = await queryNode(fixing.deviceAddress);
          break;
        }
        case 'command': {
          fixSucceeded = await sendNodeCommand(
            fixing.deviceAddress,
            action.command!,
            action.value,
          );
          break;
        }
        case 'none': {
          // No actionable fix — mark as failed
          fixSucceeded = false;
          break;
        }
      }

      // ── Step 3: Evaluate Result ──
      if (fixSucceeded) {
        const resolved: Incident = {
          ...fixing,
          status: 'resolved',
          resolution: `Applied fix: ${action.type === 'query' ? 're-queried device' : action.type === 'command' ? `sent ${action.command}` : 'no action'}`,
        };
        set((s) => ({
          activeIncident: null,
          incidents: s.incidents.map((inc) => (inc.id === target.id ? resolved : inc)),
        }));
        logIncident(resolved, `Self-healed: ${resolved.resolution}`, 'success');
      } else if (fixing.attempts < MAX_RETRIES) {
        // Retry: reset to detected for another pass
        const retry: Incident = { ...fixing, status: 'detected' };
        set((s) => ({
          activeIncident: null,
          incidents: s.incidents.map((inc) => (inc.id === target.id ? retry : inc)),
        }));
        logIncident(retry, `Fix attempt ${fixing.attempts} failed, retrying`, 'fail');
        // Schedule next attempt (brief delay to avoid tight loop)
        setTimeout(() => {
          void get().processNext();
        }, 2000);
      } else {
        // Exhausted retries
        const failed: Incident = {
          ...fixing,
          status: 'failed',
          resolution: `Exhausted ${MAX_RETRIES} retry attempts. Manual intervention required.`,
        };
        set((s) => ({
          activeIncident: null,
          incidents: s.incidents.map((inc) => (inc.id === target.id ? failed : inc)),
        }));
        logIncident(failed, `Self-healing failed after ${MAX_RETRIES} attempts`, 'fail');
      }
    } catch (err) {
      // Unexpected error in the pipeline itself
      const errMsg = err instanceof Error ? err.message : 'Unknown pipeline error';
      const failed: Incident = {
        ...diagnosing,
        status: 'failed',
        resolution: `Pipeline error: ${errMsg}`,
      };
      set((s) => ({
        activeIncident: null,
        incidents: s.incidents.map((inc) => (inc.id === target.id ? failed : inc)),
      }));
      logIncident(failed, `Self-healing pipeline error: ${errMsg}`, 'fail');
    }

    // Process any remaining detected incidents
    const remaining = get().incidents.find((inc) => inc.status === 'detected');
    if (remaining && !get().activeIncident) {
      void get().processNext();
    }
  },

  setEnabled: (enabled) => {
    set({ enabled });
  },

  clearResolved: () => {
    set((s) => ({
      incidents: s.incidents.filter(
        (inc) => inc.status !== 'resolved' && inc.status !== 'failed',
      ),
    }));
  },

  getRecent: (count = 10) => {
    return get().incidents.slice(0, count);
  },
}));
