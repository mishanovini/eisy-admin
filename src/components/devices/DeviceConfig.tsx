/**
 * Device configuration panel — shows Z-Wave configuration parameters
 * with AI-powered labeling for human-readable names and descriptions.
 *
 * - If a cached profile exists, shows labeled params with appropriate controls
 *   (sliders, dropdowns, toggles)
 * - If no profile, shows raw params with an "AI Label" button
 * - When "AI Label" is clicked, builds the prompt and sends to AI, then caches
 */
import { useState, useCallback } from 'react';
import {
  Sparkles,
  Loader2,
  Info,
  Save,
  RotateCcw,
} from 'lucide-react';
import {
  useConfigIntelligenceStore,
  getConfigAI,
  type ParamLabel,
  type RawParam,
} from '@/ai/config-intelligence.ts';
import { queryConfigParam, setConfigParam } from '@/api/soap.ts';
import { getDeviceTypeInfo } from '@/utils/device-types.ts';
import { useDeviceStore } from '@/stores/device-store.ts';

// ─── Types ───────────────────────────────────────────────────

interface DeviceConfigProps {
  /** Device address (e.g., "ZW005_1") */
  address: string;
  /** ISY nodeDefId for AI context */
  nodeDefId: string;
}

interface ParamState {
  id: number;
  value: number;
  size: number;
  dirty: boolean;
  saving: boolean;
}

// ─── Component ───────────────────────────────────────────────

export function DeviceConfig({ address, nodeDefId }: DeviceConfigProps) {
  const [params, setParams] = useState<ParamState[]>([]);
  const [loading, setLoading] = useState(false);
  const [labeling, setLabeling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const profile = useConfigIntelligenceStore((s) => s.getProfile(nodeDefId));
  const buildPrompt = useConfigIntelligenceStore((s) => s.buildLabelPrompt);
  const parseResponse = useConfigIntelligenceStore((s) => s.parseLabelResponse);
  const cacheProfile = useConfigIntelligenceStore((s) => s.cacheProfile);

  const node = useDeviceStore((s) => s.getNode(address));
  const nodeType = node?.type ? String(node.type) : undefined;
  const typeInfo = getDeviceTypeInfo(nodeDefId, nodeType);

  // ─── Fetch raw params from the device ───

  const fetchParams = useCallback(async (paramIds: number[]) => {
    setLoading(true);
    setError(null);
    try {
      const results: ParamState[] = [];
      for (const id of paramIds) {
        const result = await queryConfigParam(address, id);
        if (result.success) {
          // The SOAP response doesn't return the value directly in our SoapResult;
          // we track the param as fetched with a default. The real value comes
          // from the status update via WebSocket. For now, initialize with 0.
          results.push({ id, value: 0, size: 1, dirty: false, saving: false });
        }
      }
      setParams(results);
      setFetched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch parameters');
    } finally {
      setLoading(false);
    }
  }, [address]);

  // ─── Fetch common Z-Wave config params (1-20) ───

  const handleFetchCommon = useCallback(async () => {
    const commonIds = Array.from({ length: 20 }, (_, i) => i + 1);
    await fetchParams(commonIds);
  }, [fetchParams]);

  // ─── AI Labeling ───

  const handleAILabel = useCallback(async () => {
    const ai = getConfigAI();
    if (!ai) {
      setError('AI not configured. Set up an AI provider in Settings first.');
      return;
    }

    const rawParams: RawParam[] = params.map((p) => ({
      id: p.id,
      value: p.value,
      size: p.size,
    }));

    if (rawParams.length === 0) {
      setError('No parameters loaded. Fetch parameters first.');
      return;
    }

    setLabeling(true);
    setError(null);

    try {
      const prompt = buildPrompt(nodeDefId, typeInfo.label, rawParams);
      const response = await ai(prompt);
      const labels = parseResponse(response);

      if (labels.length === 0) {
        setError('AI returned no valid labels. Try again.');
        return;
      }

      cacheProfile(nodeDefId, typeInfo.label, labels);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI labeling failed');
    } finally {
      setLabeling(false);
    }
  }, [params, nodeDefId, typeInfo.label, buildPrompt, parseResponse, cacheProfile]);

  // ─── Update a param value locally ───

  const updateParam = useCallback((paramId: number, value: number) => {
    setParams((prev) =>
      prev.map((p) =>
        p.id === paramId ? { ...p, value, dirty: true } : p,
      ),
    );
  }, []);

  // ─── Save a single param to the device ───

  const saveParam = useCallback(async (paramId: number) => {
    const param = params.find((p) => p.id === paramId);
    if (!param) return;

    setParams((prev) =>
      prev.map((p) => (p.id === paramId ? { ...p, saving: true } : p)),
    );

    try {
      const result = await setConfigParam(address, paramId, param.value, param.size);
      if (result.success) {
        setParams((prev) =>
          prev.map((p) =>
            p.id === paramId ? { ...p, dirty: false, saving: false } : p,
          ),
        );
      } else {
        setError(`Failed to save parameter ${paramId}`);
        setParams((prev) =>
          prev.map((p) => (p.id === paramId ? { ...p, saving: false } : p)),
        );
      }
    } catch {
      setError(`Error saving parameter ${paramId}`);
      setParams((prev) =>
        prev.map((p) => (p.id === paramId ? { ...p, saving: false } : p)),
      );
    }
  }, [address, params]);

  // ─── Render ───

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Configuration Parameters
        </h3>
        <div className="flex items-center gap-2">
          {!fetched && (
            <button
              onClick={handleFetchCommon}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {loading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RotateCcw size={12} />
              )}
              Fetch Params
            </button>
          )}
          {fetched && !profile && params.length > 0 && (
            <button
              onClick={handleAILabel}
              disabled={labeling}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
            >
              {labeling ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              AI Label
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-gray-400" />
          <span className="ml-2 text-sm text-gray-400">Fetching parameters...</span>
        </div>
      )}

      {/* AI labeling in progress */}
      {labeling && (
        <div className="flex items-center justify-center py-8">
          <Sparkles size={20} className="animate-pulse text-purple-400" />
          <span className="ml-2 text-sm text-purple-400">AI is analyzing parameters...</span>
        </div>
      )}

      {/* No params fetched yet */}
      {!fetched && !loading && (
        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Click "Fetch Params" to read configuration parameters from the device.
          </p>
        </div>
      )}

      {/* Params list — labeled or raw */}
      {fetched && !loading && !labeling && params.length > 0 && (
        <div className="space-y-2">
          {params.map((param) => {
            const label = profile?.params.find((l) => l.paramId === param.id);
            return label ? (
              <LabeledParam
                key={param.id}
                param={param}
                label={label}
                onChange={updateParam}
                onSave={saveParam}
              />
            ) : (
              <RawParamRow
                key={param.id}
                param={param}
                onChange={updateParam}
                onSave={saveParam}
              />
            );
          })}
        </div>
      )}

      {/* No params found */}
      {fetched && !loading && params.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No configuration parameters found for this device.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Labeled Parameter Row ───────────────────────────────────

function LabeledParam({
  param,
  label,
  onChange,
  onSave,
}: {
  param: ParamState;
  label: ParamLabel;
  onChange: (paramId: number, value: number) => void;
  onSave: (paramId: number) => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
      {/* Header: name + info tooltip */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {label.name}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            (#{label.paramId})
          </span>
          <div className="relative">
            <button
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <Info size={12} />
            </button>
            {showTooltip && (
              <div className="absolute bottom-full left-1/2 z-10 mb-1 w-48 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 shadow-lg dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {label.description}
                {label.recommended != null && (
                  <div className="mt-1 text-gray-400 dark:text-gray-500">
                    Recommended: {label.recommended}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {param.dirty && (
          <button
            onClick={() => onSave(param.id)}
            disabled={param.saving}
            className="flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {param.saving ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Save size={10} />
            )}
            Save
          </button>
        )}
      </div>

      {/* Control based on param type */}
      {label.type === 'boolean' && (
        <BooleanControl
          value={param.value}
          options={label.options}
          onChange={(v) => onChange(param.id, v)}
        />
      )}
      {label.type === 'enum' && label.options && (
        <EnumControl
          value={param.value}
          options={label.options}
          onChange={(v) => onChange(param.id, v)}
        />
      )}
      {label.type === 'range' && (
        <RangeControl
          value={param.value}
          min={label.min ?? 0}
          max={label.max ?? 255}
          onChange={(v) => onChange(param.id, v)}
        />
      )}
      {label.type === 'number' && (
        <NumberControl
          value={param.value}
          min={label.min}
          max={label.max}
          onChange={(v) => onChange(param.id, v)}
        />
      )}
    </div>
  );
}

// ─── Raw Parameter Row ───────────────────────────────────────

function RawParamRow({
  param,
  onChange,
  onSave,
}: {
  param: ParamState;
  onChange: (paramId: number, value: number) => void;
  onSave: (paramId: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
      <span className="w-20 text-xs font-medium text-gray-500 dark:text-gray-400">
        Param #{param.id}
      </span>
      <input
        type="number"
        value={param.value}
        onChange={(e) => onChange(param.id, Number(e.target.value))}
        className="w-24 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      />
      <span className="text-xs text-gray-400 dark:text-gray-500">
        {param.size}B
      </span>
      {param.dirty && (
        <button
          onClick={() => onSave(param.id)}
          disabled={param.saving}
          className="flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {param.saving ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Save size={10} />
          )}
          Save
        </button>
      )}
    </div>
  );
}

// ─── Control Components ──────────────────────────────────────

/** Toggle between two states (typically 0/1) */
function BooleanControl({
  value,
  options,
  onChange,
}: {
  value: number;
  options?: { value: number; label: string }[];
  onChange: (value: number) => void;
}) {
  const offLabel = options?.find((o) => o.value === 0)?.label ?? 'Disabled';
  const onLabel = options?.find((o) => o.value === 1)?.label ?? 'Enabled';
  const isOn = value > 0;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(isOn ? 0 : 1)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          isOn
            ? 'bg-blue-600'
            : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            isOn ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <span className="text-xs text-gray-600 dark:text-gray-400">
        {isOn ? onLabel : offLabel}
      </span>
    </div>
  );
}

/** Dropdown select for enum values */
function EnumControl({
  value,
  options,
  onChange,
}: {
  value: number;
  options: { value: number; label: string }[];
  onChange: (value: number) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/** Slider with min/max and current value display */
function RangeControl({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 text-right text-xs text-gray-400 dark:text-gray-500">
        {min}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-blue-600 dark:bg-gray-700"
      />
      <span className="w-8 text-xs text-gray-400 dark:text-gray-500">
        {max}
      </span>
      <span className="w-12 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
        {value}
      </span>
    </div>
  );
}

/** Plain number input with optional min/max */
function NumberControl({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-28 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
    />
  );
}
