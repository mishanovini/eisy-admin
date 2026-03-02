/**
 * Proactive Suggestions Engine — periodically analyzes device, status, and
 * program data to surface actionable improvement suggestions to the user.
 *
 * Categories:
 *  - battery:      Low battery warnings for battery-powered devices
 *  - comms:        Communication failure rate alerts
 *  - unused:       Devices that haven't been active in a long time
 *  - organization: Suggestions to group related devices into folders
 *  - automation:   Ideas for new programs based on existing hardware
 *
 * Pure-logic analysis handles battery, comms, and unused detection.
 * Organization and automation suggestions expose `getAIPrompt()` to build
 * a context prompt for AI-powered analysis.
 */
import { create } from 'zustand';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useStatusStore } from '@/stores/status-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import type { IsyNode, IsyProperty } from '@/api/types.ts';

// ─── Types ───────────────────────────────────────────────────

export type SuggestionCategory =
  | 'battery'
  | 'comms'
  | 'unused'
  | 'organization'
  | 'automation';

export type SuggestionPriority = 'high' | 'medium' | 'low';

export interface Suggestion {
  id: string;
  category: SuggestionCategory;
  priority: SuggestionPriority;
  title: string;
  description: string;
  deviceAddress?: string;
  dismissed: boolean;
}

interface SuggestionsState {
  suggestions: Suggestion[];
  lastAnalyzed: number | null;

  /** Run a full analysis across all stores and regenerate suggestions. */
  analyze: () => void;
  /** Dismiss a suggestion by id (hides it from active list). */
  dismiss: (id: string) => void;
  /** Clear all suggestions. */
  clearAll: () => void;
  /** Get non-dismissed suggestions. */
  getActive: () => Suggestion[];
  /** Get non-dismissed suggestions filtered by category. */
  getByCategory: (cat: SuggestionCategory) => Suggestion[];
  /** Build a prompt for AI-powered organization & automation suggestions. */
  getAIPrompt: () => string;
}

// ─── Constants ───────────────────────────────────────────────

/** UOM 51 = percentage (used for battery level properties) */
const UOM_PERCENT = '51';

/** Battery property IDs that indicate a battery level reading */
const BATTERY_PROP_IDS = new Set(['BATLVL', 'GV2', 'ST']);

/** Thresholds */
const BATTERY_HIGH_THRESHOLD = 20;
const BATTERY_MEDIUM_THRESHOLD = 50;

/** Communication failure rate thresholds (0-1) */
const COMMS_HIGH_THRESHOLD = 0.40;
const COMMS_MEDIUM_THRESHOLD = 0.20;

/** Communication error property IDs */
const COMMS_ERR_PROP = 'ERR';

/** Monotonic counter for deterministic suggestion IDs */
let suggestionCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}_${++suggestionCounter}`;
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Extract a battery-level percentage from a node's status properties.
 * Returns the numeric percentage if found, or `null` if the node has
 * no battery property with UOM 51.
 */
function getBatteryLevel(
  address: string,
  statusProps: Map<string, Map<string, IsyProperty>>,
): number | null {
  const nodeProps = statusProps.get(String(address));
  if (!nodeProps) return null;

  for (const propId of BATTERY_PROP_IDS) {
    const prop = nodeProps.get(propId);
    if (prop && String(prop['@_uom']) === UOM_PERCENT) {
      const val = Number(prop['@_value']);
      if (!Number.isNaN(val) && val >= 0 && val <= 100) {
        return val;
      }
    }
  }
  return null;
}

/**
 * Detect whether a node has communication issues by looking at the ERR
 * property. Many ISY nodes report error counts or error-rate values.
 * Returns a failure rate 0-1, or null if no comms data exists.
 */
function getCommsFailureRate(
  address: string,
  statusProps: Map<string, Map<string, IsyProperty>>,
): number | null {
  const nodeProps = statusProps.get(String(address));
  if (!nodeProps) return null;

  const errProp = nodeProps.get(COMMS_ERR_PROP);
  if (!errProp) return null;

  const val = Number(errProp['@_value']);
  if (Number.isNaN(val)) return null;

  // ERR values > 1 are typically counts; normalize to a 0-1 rate.
  // Values already between 0 and 1 are treated as a rate directly.
  if (val > 1) {
    // Heuristic: treat as a percentage (0-100) if > 1
    return Math.min(val / 100, 1);
  }
  return val;
}

/**
 * Check whether a device appears "unused" by inspecting its status
 * properties. A device with all properties at 0 / empty is considered
 * potentially unused. This is a heuristic since ISY doesn't track
 * last-activity timestamps directly.
 */
function looksUnused(
  address: string,
  node: IsyNode,
  statusProps: Map<string, Map<string, IsyProperty>>,
): boolean {
  // Disabled nodes are explicitly unused
  if (node.enabled === false || node.enabled === 'false') return true;

  const nodeProps = statusProps.get(String(address));
  // No status data at all = possibly offline/unused
  if (!nodeProps || nodeProps.size === 0) return true;

  // Check if the primary status (ST) property is 0 or empty
  const st = nodeProps.get('ST');
  if (st) {
    const val = String(st['@_value']);
    // " " is ISY's representation for "no value"
    if (val === ' ' || val === '' || val === '0') {
      // Only flag as unused if there are no other meaningful properties
      let hasOtherValue = false;
      for (const [propId, prop] of nodeProps) {
        if (propId === 'ST' || propId === 'ERR') continue;
        const pval = String(prop['@_value']);
        if (pval !== ' ' && pval !== '' && pval !== '0') {
          hasOtherValue = true;
          break;
        }
      }
      if (!hasOtherValue) return true;
    }
  }

  return false;
}

/**
 * Extract a human-readable device type from the nodeDefId.
 * e.g., "MotionSensor_ADv2" -> "MotionSensor"
 */
function deviceTypeLabel(nodeDefId: string | undefined): string {
  if (!nodeDefId) return 'Unknown';
  // Strip trailing version suffixes like _ADv2, _v2, etc.
  return nodeDefId.replace(/_(?:AD)?v?\d+$/i, '').replace(/_/g, ' ');
}

/**
 * Group nodes by their folder (parent address) for organization analysis.
 * Returns a map of parentAddress -> array of nodes.
 */
function groupByParent(nodes: IsyNode[]): Map<string | null, IsyNode[]> {
  const groups = new Map<string | null, IsyNode[]>();
  for (const node of nodes) {
    const rawParent = node.parent?.['#text'];
    const parent = rawParent != null ? String(rawParent) : null;
    const existing = groups.get(parent) ?? [];
    existing.push(node);
    groups.set(parent, existing);
  }
  return groups;
}

// ─── Analysis Functions ──────────────────────────────────────

function analyzeBattery(
  nodes: IsyNode[],
  statusProps: Map<string, Map<string, IsyProperty>>,
): Suggestion[] {
  const results: Suggestion[] = [];

  for (const node of nodes) {
    const level = getBatteryLevel(node.address, statusProps);
    if (level === null) continue;

    if (level < BATTERY_HIGH_THRESHOLD) {
      results.push({
        id: nextId('bat'),
        category: 'battery',
        priority: 'high',
        title: `${node.name} battery critically low`,
        description: `Device "${node.name}" battery at ${level}%, replace soon.`,
        deviceAddress: node.address,
        dismissed: false,
      });
    } else if (level < BATTERY_MEDIUM_THRESHOLD) {
      results.push({
        id: nextId('bat'),
        category: 'battery',
        priority: 'medium',
        title: `${node.name} battery getting low`,
        description: `Device "${node.name}" battery at ${level}%, consider replacing.`,
        deviceAddress: node.address,
        dismissed: false,
      });
    }
  }

  return results;
}

function analyzeComms(
  nodes: IsyNode[],
  statusProps: Map<string, Map<string, IsyProperty>>,
): Suggestion[] {
  const results: Suggestion[] = [];

  for (const node of nodes) {
    const rate = getCommsFailureRate(node.address, statusProps);
    if (rate === null) continue;

    if (rate >= COMMS_HIGH_THRESHOLD) {
      const pct = Math.round(rate * 100);
      results.push({
        id: nextId('com'),
        category: 'comms',
        priority: 'high',
        title: `${node.name} has high failure rate`,
        description: `Device "${node.name}" has a ${pct}% communication failure rate and needs attention.`,
        deviceAddress: node.address,
        dismissed: false,
      });
    } else if (rate >= COMMS_MEDIUM_THRESHOLD) {
      const pct = Math.round(rate * 100);
      results.push({
        id: nextId('com'),
        category: 'comms',
        priority: 'medium',
        title: `${node.name} communication issues`,
        description: `Device "${node.name}" has a ${pct}% communication failure rate, worth investigating.`,
        deviceAddress: node.address,
        dismissed: false,
      });
    }
  }

  return results;
}

function analyzeUnused(
  nodes: IsyNode[],
  statusProps: Map<string, Map<string, IsyProperty>>,
): Suggestion[] {
  const results: Suggestion[] = [];

  for (const node of nodes) {
    if (!looksUnused(node.address, node, statusProps)) continue;

    results.push({
      id: nextId('unu'),
      category: 'unused',
      priority: 'low',
      title: `${node.name} appears unused`,
      description: `Device "${node.name}" appears inactive with no meaningful property values. Consider removing it if no longer needed.`,
      deviceAddress: node.address,
      dismissed: false,
    });
  }

  return results;
}

function analyzeOrganization(
  nodes: IsyNode[],
  folderNames: Map<string, string>,
): Suggestion[] {
  const results: Suggestion[] = [];

  // Group nodes by parent folder
  const groups = groupByParent(nodes);

  for (const [parentAddr, groupNodes] of groups) {
    // Skip already-foldered nodes (parent is a known folder)
    if (parentAddr && folderNames.has(parentAddr)) continue;

    // Look for clusters of same-type devices at the root level
    const byType = new Map<string, IsyNode[]>();
    for (const n of groupNodes) {
      const defId = n['@_nodeDefId'] ?? 'unknown';
      const existing = byType.get(defId) ?? [];
      existing.push(n);
      byType.set(defId, existing);
    }

    for (const [defId, typeNodes] of byType) {
      if (typeNodes.length < 3) continue;

      const typeLabel = deviceTypeLabel(defId);
      const names = typeNodes.map((n) => n.name).join(', ');
      results.push({
        id: nextId('org'),
        category: 'organization',
        priority: 'low',
        title: `Group ${typeNodes.length} ${typeLabel} devices`,
        description: `${typeNodes.length} ${typeLabel} devices (${names}) are ungrouped. Consider creating a folder to organize them.`,
        dismissed: false,
      });
    }
  }

  return results;
}

function analyzeAutomation(
  nodes: IsyNode[],
  programNames: Set<string>,
): Suggestion[] {
  const results: Suggestion[] = [];

  // Identify sensor nodes that could benefit from automation
  const sensorDefPatterns = [
    'MotionSensor',
    'motion',
    'DoorSensor',
    'door',
    'LeakSensor',
    'leak',
    'TempSensor',
    'temp',
    'OpenCloseSensor',
  ];

  const sensorNodes = nodes.filter((n) => {
    const defId = n['@_nodeDefId'] ?? '';
    const nameLower = n.name.toLowerCase();
    return sensorDefPatterns.some(
      (p) =>
        defId.toLowerCase().includes(p.toLowerCase()) ||
        nameLower.includes(p.toLowerCase()),
    );
  });

  // Check if sensors have corresponding programs
  for (const sensor of sensorNodes) {
    const nameLower = sensor.name.toLowerCase();
    const addrNormalized = sensor.address.replace(/\s/g, '');

    // Check if any program references this sensor by name or address
    const hasProgram = [...programNames].some((pName) => {
      const pLower = pName.toLowerCase();
      return (
        pLower.includes(nameLower) ||
        nameLower.includes(pLower) ||
        pLower.includes(addrNormalized)
      );
    });

    if (!hasProgram) {
      const typeLabel = deviceTypeLabel(sensor['@_nodeDefId']);
      results.push({
        id: nextId('aut'),
        category: 'automation',
        priority: 'medium',
        title: `No program for ${sensor.name}`,
        description: `You have a ${typeLabel} ("${sensor.name}") but no programs appear to use it. Consider creating an automation.`,
        deviceAddress: sensor.address,
        dismissed: false,
      });
    }
  }

  return results;
}

// ─── AI Prompt Builder ───────────────────────────────────────

function buildAIPrompt(): string {
  const { nodes, folders } = useDeviceStore.getState();
  const { properties: statusProps } = useStatusStore.getState();
  const { programs } = useProgramStore.getState();

  // Build a compact device summary
  const deviceSummary = nodes.map((n) => {
    const defId = n['@_nodeDefId'] ?? 'unknown';
    const parent = n.parent?.['#text'] ?? 'root';
    const nodeProps = statusProps.get(String(n.address));
    const propCount = nodeProps?.size ?? 0;
    return `  - "${n.name}" (${n.address}) type=${defId} folder=${parent} props=${propCount}`;
  });

  const folderSummary = folders.map((f) => `  - "${f.name}" (${f.address})`);

  const programSummary = programs.map((p) => {
    const enabled = p['@_enabled'] === 'true';
    const status = p['@_status'];
    return `  - "${p.name}" (id=${p['@_id']}) enabled=${enabled} status=${status}`;
  });

  return `You are analyzing an ISY/eisy smart home controller system to suggest improvements.

DEVICES (${nodes.length} total):
${deviceSummary.join('\n')}

FOLDERS (${folders.length} total):
${folderSummary.length > 0 ? folderSummary.join('\n') : '  (none)'}

PROGRAMS (${programs.length} total):
${programSummary.length > 0 ? programSummary.join('\n') : '  (none)'}

Based on the devices, folders, and programs above, suggest:
1. ORGANIZATION: Are there devices that should be grouped into folders? Are there naming inconsistencies?
2. AUTOMATION IDEAS: Are there sensors or devices that could benefit from new programs? Are there common automation patterns missing (e.g., motion-triggered lighting, leak alerts, temperature-based HVAC control)?

For each suggestion, provide:
- Category: "organization" or "automation"
- Priority: "high", "medium", or "low"
- Title: A brief title (under 60 characters)
- Description: A 1-2 sentence explanation

Format each suggestion as JSON on its own line:
{"category":"...","priority":"...","title":"...","description":"..."}`;
}

// ─── Store ───────────────────────────────────────────────────

export const useSuggestionsStore = create<SuggestionsState>((set, get) => ({
  suggestions: [],
  lastAnalyzed: null,

  analyze: () => {
    const { nodes, folderMap } = useDeviceStore.getState();
    const { properties: statusProps } = useStatusStore.getState();
    const { programs } = useProgramStore.getState();

    // Build lookup maps
    const folderNames = new Map<string, string>();
    for (const [addr, folder] of folderMap) {
      folderNames.set(addr, folder.name);
    }

    const programNames = new Set<string>(programs.map((p) => p.name));

    // Run all pure-logic analyzers
    const newSuggestions: Suggestion[] = [
      ...analyzeBattery(nodes, statusProps),
      ...analyzeComms(nodes, statusProps),
      ...analyzeUnused(nodes, statusProps),
      ...analyzeOrganization(nodes, folderNames),
      ...analyzeAutomation(nodes, programNames),
    ];

    // Re-dismiss any suggestions whose device+category combo was previously dismissed
    // (IDs change each analysis, so match on content instead)
    const previouslyDismissed = get().suggestions.filter((s) => s.dismissed);
    const dismissKey = (s: Suggestion) =>
      `${s.category}:${s.deviceAddress ?? ''}:${s.title}`;
    const dismissedKeys = new Set(previouslyDismissed.map(dismissKey));

    for (const s of newSuggestions) {
      if (dismissedKeys.has(dismissKey(s))) {
        s.dismissed = true;
      }
    }

    set({
      suggestions: newSuggestions,
      lastAnalyzed: Date.now(),
    });
  },

  dismiss: (id) => {
    set((s) => ({
      suggestions: s.suggestions.map((sug) =>
        sug.id === id ? { ...sug, dismissed: true } : sug,
      ),
    }));
  },

  clearAll: () => {
    set({ suggestions: [], lastAnalyzed: null });
  },

  getActive: () => {
    return get().suggestions.filter((s) => !s.dismissed);
  },

  getByCategory: (cat) => {
    return get().suggestions.filter((s) => !s.dismissed && s.category === cat);
  },

  getAIPrompt: () => {
    return buildAIPrompt();
  },
}));
