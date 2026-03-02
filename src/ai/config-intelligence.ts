/**
 * Config Intelligence — AI-powered labeling of device configuration parameters.
 *
 * Architecture:
 *  - Zustand store caches AI-generated labels per device type (nodeDefId)
 *  - Builds prompts asking the AI to identify parameter meanings
 *  - Cached results stored in memory (cleared on page reload)
 *  - Callback-based AI integration (same pattern as self-healing)
 */
import { create } from 'zustand';

// ─── Types ───────────────────────────────────────────────────

export interface ParamLabel {
  paramId: number;
  name: string;
  description: string;
  type: 'range' | 'enum' | 'boolean' | 'number';
  min?: number;
  max?: number;
  options?: { value: number; label: string }[];
  recommended?: number;
}

export interface DeviceConfigProfile {
  nodeDefId: string;
  deviceType: string;
  params: ParamLabel[];
  fetchedAt: number;
}

export interface RawParam {
  id: number;
  value: number;
  size: number;
}

interface ConfigIntelligenceState {
  profiles: Map<string, DeviceConfigProfile>;
  loading: boolean;

  /** Get cached profile or null */
  getProfile: (nodeDefId: string) => DeviceConfigProfile | null;
  /** Build prompt for AI to label parameters */
  buildLabelPrompt: (nodeDefId: string, deviceType: string, rawParams: RawParam[]) => string;
  /** Parse AI response into ParamLabel array */
  parseLabelResponse: (response: string) => ParamLabel[];
  /** Cache a profile after AI labeling */
  cacheProfile: (nodeDefId: string, deviceType: string, params: ParamLabel[]) => void;
  /** Set the loading state */
  setLoading: (loading: boolean) => void;
  /** Clear all cached profiles */
  clearProfiles: () => void;
}

// ─── AI Callback Registration ────────────────────────────────

/**
 * Registered AI callback (set by app startup to avoid circular deps).
 * Same pattern as self-healing: the caller passes in a function
 * so this module never imports provider.ts directly.
 */
type AICallback = (prompt: string) => Promise<string>;
let aiCallback: AICallback | null = null;

export function registerConfigAI(fn: AICallback): void {
  aiCallback = fn;
}

export function getConfigAI(): AICallback | null {
  return aiCallback;
}

// ─── Prompt Builder ──────────────────────────────────────────

function buildParamTable(rawParams: RawParam[]): string {
  const header = '| Param ID | Current Value | Size (bytes) |';
  const divider = '|----------|---------------|--------------|';
  const rows = rawParams.map(
    (p) => `| ${p.id.toString().padEnd(8)} | ${p.value.toString().padEnd(13)} | ${p.size.toString().padEnd(12)} |`,
  );
  return [header, divider, ...rows].join('\n');
}

// ─── Response Parser ─────────────────────────────────────────

/**
 * Parse the AI response into a ParamLabel array.
 * Handles JSON wrapped in markdown code fences or raw JSON.
 */
function parseResponse(response: string): ParamLabel[] {
  // Strip markdown code fences if present
  let cleaned = response.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1]!.trim();
  }

  // Try to find a JSON array in the response
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return [];

    // Validate and normalize each entry
    return parsed
      .filter(
        (item: unknown): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && 'paramId' in item,
      )
      .map((item) => {
        const label: ParamLabel = {
          paramId: Number(item.paramId),
          name: String(item.name ?? `Parameter ${item.paramId}`),
          description: String(item.description ?? ''),
          type: validateParamType(String(item.type ?? 'number')),
        };

        if (item.min != null) label.min = Number(item.min);
        if (item.max != null) label.max = Number(item.max);
        if (item.recommended != null) label.recommended = Number(item.recommended);

        if (Array.isArray(item.options)) {
          label.options = item.options
            .filter(
              (opt: unknown): opt is Record<string, unknown> =>
                typeof opt === 'object' && opt !== null,
            )
            .map((opt) => ({
              value: Number(opt.value ?? 0),
              label: String(opt.label ?? `Option ${opt.value}`),
            }));
        }

        return label;
      });
  } catch {
    return [];
  }
}

function validateParamType(type: string): ParamLabel['type'] {
  const valid: ParamLabel['type'][] = ['range', 'enum', 'boolean', 'number'];
  return valid.includes(type as ParamLabel['type'])
    ? (type as ParamLabel['type'])
    : 'number';
}

// ─── Store ───────────────────────────────────────────────────

export const useConfigIntelligenceStore = create<ConfigIntelligenceState>((set, get) => ({
  profiles: new Map(),
  loading: false,

  getProfile: (nodeDefId: string): DeviceConfigProfile | null => {
    return get().profiles.get(nodeDefId) ?? null;
  },

  buildLabelPrompt: (nodeDefId: string, deviceType: string, rawParams: RawParam[]): string => {
    const table = buildParamTable(rawParams);
    return `You are analyzing configuration parameters for a ${deviceType} device (nodeDefId: ${nodeDefId}).

Here are the raw configuration parameters:
${table}

For each parameter, provide:
1. A human-readable name
2. A brief description of what it controls
3. The input type (range, enum, boolean, number)
4. Min/max values if applicable
5. Enum options if applicable
6. Recommended value if known

Respond in JSON format as an array:
[{ "paramId": 1, "name": "...", "description": "...", "type": "range", "min": 0, "max": 255 }, ...]

For boolean parameters, use min: 0 and max: 1 with options [{ "value": 0, "label": "Disabled" }, { "value": 1, "label": "Enabled" }].
For enum parameters, include all valid options in the "options" array.
For range parameters, include min and max values appropriate for the parameter size.
Include a "recommended" value when you know the typical default.

IMPORTANT: Return ONLY the JSON array, no other text.`;
  },

  parseLabelResponse: (response: string): ParamLabel[] => {
    return parseResponse(response);
  },

  cacheProfile: (nodeDefId: string, deviceType: string, params: ParamLabel[]) => {
    set((state) => {
      const profiles = new Map(state.profiles);
      profiles.set(nodeDefId, {
        nodeDefId,
        deviceType,
        params,
        fetchedAt: Date.now(),
      });
      return { profiles };
    });
  },

  setLoading: (loading: boolean) => {
    set({ loading });
  },

  clearProfiles: () => {
    set({ profiles: new Map() });
  },
}));
