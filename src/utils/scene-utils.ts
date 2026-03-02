/**
 * Scene utility functions — ramp rate lookup, on-level conversion, member extraction.
 *
 * The Insteon protocol uses a 32-entry ramp rate table (indices 0-31)
 * mapping to times in seconds. These values come from the Insteon hardware
 * specification and are used in the DeviceSpecific SOAP operations.
 */
import type { IsyGroup, IsyGroupLink } from '@/api/types.ts';

// ─── Scene Member Extraction ──────────────────────────────────

/** A device's membership in a scene, with its role (controller or responder) */
export interface SceneMember {
  address: string;
  name: string;
  role: 'controller' | 'responder';
  nodeDefId?: string;
  /** ISY type field (e.g., "4.64.3.0") — used for Z-Wave device classification */
  nodeType?: string;
}

/**
 * Extract scene members from an ISY group (scene).
 *
 * Parses the members.link array from the XML, resolving device names from
 * the node map. Link `@_type` of 16 = controller, 32 = responder.
 * Returns sorted: controllers first, then alphabetical.
 */
export function getSceneMembers(
  scene: IsyGroup,
  nodeMap: Map<string, { name: string; '@_nodeDefId'?: string; type?: string }>,
): SceneMember[] {
  if (!scene.members?.link) return [];

  const links = Array.isArray(scene.members.link) ? scene.members.link : [scene.members.link];

  return links
    .map((link: IsyGroupLink) => {
      const addr = String(link['#text']);
      const node = nodeMap.get(addr);
      // Link type: 16 = controller, 32 = responder (in the eisy XML)
      const role: 'controller' | 'responder' = link['@_type'] === 16 ? 'controller' : 'responder';
      return {
        address: addr,
        name: node?.name ?? addr,
        role,
        nodeDefId: node?.['@_nodeDefId'],
        nodeType: node?.type ? String(node.type) : undefined,
      };
    })
    .sort((a, b) => {
      // Controllers first, then alphabetical
      if (a.role !== b.role) return a.role === 'controller' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

// ─── Ramp Rates + On Levels ───────────────────────────────────

/**
 * Insteon ramp rate table (indices 0-31 → seconds).
 *
 * Index 0 is the slowest (9 minutes), index 31 is the fastest (0.1 seconds).
 * The Admin Console displays these as human-readable durations.
 */
export const RAMP_RATES: readonly number[] = [
  540, 480, 420, 360, 300, 270, 240, 210,
  180, 150, 120,  90,  60,  47,  43, 38.5,
   34,  32,  30,  28,  26, 23.5, 21.5, 19,
  8.5, 6.5, 4.5,   2, 0.5, 0.3, 0.2, 0.1,
] as const;

/**
 * Format a ramp rate index as a human-readable duration string.
 * @param index - Ramp rate index 0-31
 * @returns e.g., "9.0 min", "2.0 sec", "0.5 sec"
 */
export function formatRampRate(index: number): string {
  const seconds = RAMP_RATES[index];
  if (seconds === undefined) return `Index ${index}`;
  if (seconds >= 60) {
    const minutes = seconds / 60;
    return minutes === Math.floor(minutes)
      ? `${minutes} min`
      : `${minutes.toFixed(1)} min`;
  }
  return seconds === Math.floor(seconds)
    ? `${seconds} sec`
    : `${seconds.toFixed(1)} sec`;
}

/**
 * Convert an on-level (0-255) to a percentage (0-100%).
 * The ISY uses 0-255 internally; the UI displays 0-100%.
 */
export function onLevelToPercent(onLevel: number): number {
  return Math.round((onLevel / 255) * 100);
}

/**
 * Convert a percentage (0-100%) to an on-level (0-255).
 */
export function percentToOnLevel(percent: number): number {
  return Math.round((percent / 100) * 255);
}

/**
 * Format an on-level as a human-readable string.
 * @param onLevel - Raw on-level value 0-255
 * @returns e.g., "100%", "75%", "Off"
 */
export function formatOnLevel(onLevel: number): string {
  if (onLevel === 0) return 'Off';
  const pct = onLevelToPercent(onLevel);
  return `${pct}%`;
}

/**
 * Format the combined action description for a scene member.
 * Matches the UDAC's "Action" column: "100% in 2.0 seconds"
 */
export function formatSceneAction(onLevel: number, rampRateIndex: number): string {
  const level = formatOnLevel(onLevel);
  const rate = formatRampRate(rampRateIndex);
  if (onLevel === 0) return `Off in ${rate}`;
  return `${level} in ${rate}`;
}

/**
 * Build dropdown options for ramp rate selection.
 * Returns [{index, label, seconds}] for all 32 ramp rate values.
 */
export function getRampRateOptions(): { index: number; label: string; seconds: number }[] {
  return RAMP_RATES.map((seconds, index) => ({
    index,
    label: formatRampRate(index),
    seconds,
  }));
}

/**
 * Build dropdown options for on-level selection.
 * Returns common percentage values: Off, 10%, 20%, ..., 100%.
 */
export function getOnLevelOptions(): { percent: number; level255: number; label: string }[] {
  const steps = [0, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];
  return steps.map((pct) => ({
    percent: pct,
    level255: percentToOnLevel(pct),
    label: pct === 0 ? 'Off' : `${pct}%`,
  }));
}
