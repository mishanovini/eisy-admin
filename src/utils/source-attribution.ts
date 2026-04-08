/**
 * Source Attribution Engine — correlates program/scene execution events
 * with subsequent device state changes to determine WHO caused each action.
 *
 * Strategy: When a program fires "running THEN/ELSE", we record its target
 * devices (from D2D trigger data). When a DON/DOF arrives within 5 seconds
 * for one of those devices, we attribute it to that program.
 *
 * For scenes, manual UI commands, AI, and portal — attribution is set
 * directly at the call site (already implemented).
 */
import { useProgramStore } from '@/stores/program-store.ts';
import { useDeviceStore } from '@/stores/device-store.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProgramExecution {
  programId: string;
  programName: string;
  clause: 'then' | 'else';
  timestamp: number;
  targetDevices: Set<string>;
}

// ─── Buffer ──────────────────────────────────────────────────────────────────

/** Short-lived buffer of recently-executed programs. Entries expire after EXPIRY_MS. */
const recentExecutions: ProgramExecution[] = [];
const EXPIRY_MS = 5_000;

/** Cache of program → target device addresses (extracted from D2D THEN/ELSE XML). */
const programTargetCache = new Map<string, Set<string>>();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register that a program just started executing its THEN or ELSE clause.
 * Called from the WebSocket handler on program event action '1' (running THEN)
 * or '2' (running ELSE).
 */
export function registerProgramExecution(programId: string, clause: 'then' | 'else'): void {
  // Clean expired entries
  const now = Date.now();
  purgeExpired(now);

  // Get target devices for this program
  const targets = getTargetDevices(programId, clause);
  const programInfo = useProgramStore.getState().getProgram(programId);
  const programName = programInfo?.name ?? `Program ${programId}`;

  recentExecutions.push({
    programId,
    programName,
    clause,
    timestamp: now,
    targetDevices: targets,
  });
}

/**
 * Determine the source of a device state change (DON/DOF).
 * Returns a source string like 'program:001C' or 'device'.
 */
export function attributeSource(deviceAddress: string): string {
  const now = Date.now();
  purgeExpired(now);

  const addr = deviceAddress.toLowerCase();

  // Check recent program executions for a match
  for (let i = recentExecutions.length - 1; i >= 0; i--) {
    const exec = recentExecutions[i]!;
    if (exec.targetDevices.has(addr)) {
      return `program:${exec.programId}`;
    }
    // Also check address format variants (dots vs spaces)
    const addrDots = addr.replace(/ /g, '.');
    const addrSpaces = addr.replace(/\./g, ' ');
    if (exec.targetDevices.has(addrDots) || exec.targetDevices.has(addrSpaces)) {
      return `program:${exec.programId}`;
    }
  }

  return 'device';
}

/**
 * Get the human-readable name for a program attribution.
 * Returns the program name if the source is 'program:XXXX', otherwise null.
 */
export function getAttributionDetail(source: string): string | undefined {
  if (!source.startsWith('program:')) return undefined;
  const programId = source.slice('program:'.length);
  const programInfo = useProgramStore.getState().getProgram(programId);
  return programInfo?.name ?? `Program ${programId}`;
}

/**
 * Resolve a source string to a human-readable display name.
 */
export function resolveSourceName(source: string): string {
  if (source.startsWith('program:')) {
    const programId = source.slice('program:'.length);
    const programInfo = useProgramStore.getState().getProgram(programId);
    return `Program: ${programInfo?.name ?? programId}`;
  }
  if (source.startsWith('scene:')) {
    const sceneAddr = source.slice('scene:'.length);
    const sceneInfo = useDeviceStore.getState().nodeMap.get(sceneAddr);
    return `Scene: ${sceneInfo?.name ?? sceneAddr}`;
  }

  const NAMES: Record<string, string> = {
    'manual': 'Manual (Super eisy)',
    'web-user': 'Manual (Admin Console)',
    'scheduler': 'Scheduled trigger',
    'program': 'Program',
    'ai-chat': 'AI Assistant',
    'portal': 'Voice / Portal',
    'device': 'Physical switch / remote',
    'system': 'System',
    'self-healing': 'Self-Healing',
    'eisy': 'eisy system event',
  };
  return NAMES[source] ?? source;
}

// ─── Internal ────────────────────────────────────────────────────────────────

/** Remove expired entries from the buffer. */
function purgeExpired(now: number): void {
  while (recentExecutions.length > 0 && now - recentExecutions[0]!.timestamp > EXPIRY_MS) {
    recentExecutions.shift();
  }
}

/**
 * Extract target device addresses from a program's THEN or ELSE clause.
 * Caches results since D2D data rarely changes during a session.
 */
function getTargetDevices(programId: string, clause: 'then' | 'else'): Set<string> {
  const cacheKey = `${programId}:${clause}`;
  const cached = programTargetCache.get(cacheKey);
  if (cached) return cached;

  const targets = new Set<string>();
  const decimalId = parseInt(programId, 16);
  if (isNaN(decimalId)) return targets;

  const trigger = useProgramStore.getState().getTrigger(decimalId);
  if (!trigger) return targets;

  const xml = clause === 'then' ? trigger.then : trigger.else;
  if (!xml) return targets;

  // Extract all node="..." attributes from <cmd> tags
  const nodeRegex = /node\s*=\s*"([^"]+)"/gi;
  let match;
  while ((match = nodeRegex.exec(xml)) !== null) {
    targets.add(match[1]!.toLowerCase());
  }

  // Only cache non-empty results — if D2D triggers weren't loaded yet,
  // we'll retry on the next program execution instead of caching the miss.
  if (targets.size > 0) programTargetCache.set(cacheKey, targets);
  return targets;
}
