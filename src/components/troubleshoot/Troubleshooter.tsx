/**
 * Troubleshooter wizard — AI-powered diagnostic tool for eisy devices.
 * Three-step flow: Describe Issue -> Diagnosis -> Resolution.
 * Uses a registered diagnoser callback (same pattern as self-healing)
 * to send context-rich prompts and display step-by-step fixes.
 *
 * Device selection features:
 *  - Searchable checklist (replaces native <select>)
 *  - Grouped by protocol (Insteon, Z-Wave, Node Server)
 *  - Sorted alphabetically within groups
 *  - Multi-select with checkboxes
 *  - Optional — can diagnose general issues without selecting a device
 */
import { useState, useMemo, useCallback } from 'react';
import {
  AlertTriangle,
  Search,
  CheckCircle2,
  RefreshCw,
  ChevronRight,
  Loader2,
  Copy,
  Wrench,
  ClipboardCheck,
  X,
  Bug,
  FileText,
} from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useStatusStore, type NodeProperties } from '@/stores/status-store.ts';
import { useLogStore, type LogEntry } from '@/stores/log-store.ts';
import { queryNode } from '@/api/rest.ts';
import { clearLastError } from '@/api/soap.ts';
import { getProtocolFamily } from '@/utils/address.ts';
import { getDeviceTypeInfo } from '@/utils/device-types.ts';
import type { IsyNode, IsyProperty } from '@/api/types.ts';
import { IssueReportPanel } from './IssueReportPanel.tsx';
import { IssueHistory } from './IssueHistory.tsx';

// ─── Diagnoser Callback Registration ─────────────────────────

type DiagnoserFn = (prompt: string) => Promise<string>;

let diagnoser: DiagnoserFn | null = null;

/**
 * Register the AI diagnosis function. Called once at app startup.
 * Avoids circular dependencies with provider.ts — the caller
 * passes in `sendChatMessage` (or a wrapper) so this module
 * never imports it directly.
 */
export function registerTroubleshootDiagnoser(fn: DiagnoserFn): void {
  diagnoser = fn;
}

// ─── Types ───────────────────────────────────────────────────

type IssueCategory =
  | 'device-not-responding'
  | 'wrong-status'
  | 'program-not-running'
  | 'slow-response'
  | 'unknown-error'
  | 'custom';

interface IssueCategoryOption {
  value: IssueCategory;
  label: string;
  description: string;
}

type WizardStep = 1 | 2 | 3 | 4;

interface ResolutionStep {
  id: number;
  text: string;
  checked: boolean;
}

type ProtocolGroup = 'insteon' | 'zwave' | 'nodeserver' | 'unknown';

interface GroupedDevices {
  protocol: ProtocolGroup;
  label: string;
  nodes: IsyNode[];
}

// ─── Constants ───────────────────────────────────────────────

const ISSUE_CATEGORIES: IssueCategoryOption[] = [
  { value: 'device-not-responding', label: 'Device not responding', description: 'Device does not react to commands or status queries' },
  { value: 'wrong-status', label: 'Device showing wrong status', description: 'Reported state does not match physical device state' },
  { value: 'program-not-running', label: 'Program not running', description: 'A scheduled or triggered program fails to execute' },
  { value: 'slow-response', label: 'Slow response times', description: 'Commands take a long time to execute or time out intermittently' },
  { value: 'unknown-error', label: 'Unknown error', description: 'An unexpected error occurred with no clear cause' },
  { value: 'custom', label: 'Custom (describe below)', description: 'Describe your issue in your own words' },
];

const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Describe Issue',
  2: 'Diagnosis',
  3: 'Resolution',
  4: 'Report',
};

const PROTOCOL_LABELS: Record<ProtocolGroup, string> = {
  insteon: 'Insteon',
  zwave: 'Z-Wave',
  nodeserver: 'Node Server',
  unknown: 'Other',
};

const PROTOCOL_COLORS: Record<ProtocolGroup, string> = {
  insteon: 'text-green-600 dark:text-green-400',
  zwave: 'text-blue-600 dark:text-blue-400',
  nodeserver: 'text-purple-600 dark:text-purple-400',
  unknown: 'text-gray-500 dark:text-gray-400',
};

/** Order for protocol groups in the list */
const PROTOCOL_ORDER: ProtocolGroup[] = ['insteon', 'zwave', 'nodeserver', 'unknown'];

// ─── Helpers ─────────────────────────────────────────────────

function formatProperties(props: NodeProperties): string {
  if (props.size === 0) return 'No properties available';
  const lines: string[] = [];
  props.forEach((prop: IsyProperty, id: string) => {
    const formatted = prop['@_formatted'] ?? String(prop['@_value']);
    const uom = prop['@_uom'] ? ` (UOM ${prop['@_uom']})` : '';
    lines.push(`  ${id}: ${formatted}${uom}`);
  });
  return lines.join('\n');
}

/** Build prompt for a single device */
function buildDeviceSection(
  node: IsyNode,
  props: NodeProperties,
  recentLogs: LogEntry[],
): string {
  const nodeDefId = node['@_nodeDefId'] ?? 'unknown';
  const propertiesStr = formatProperties(props);

  const recentCommandsStr = recentLogs.length > 0
    ? recentLogs.map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        return `  [${time}] ${e.action} (${e.result})${e.detail ? ` — ${e.detail}` : ''}`;
      }).join('\n')
    : '  No recent commands found';

  return `Device: ${node.name} (${String(node.address)})
Device type: ${nodeDefId}
Current status:
${propertiesStr}
Recent commands:
${recentCommandsStr}`;
}

function buildDiagnosticPrompt(
  selectedNodes: IsyNode[],
  allProperties: Map<string, Map<string, IsyProperty>>,
  category: IssueCategory,
  categoryLabel: string,
  customDescription: string,
  logEntries: LogEntry[],
): string {
  const userDescription = category === 'custom' && customDescription.trim()
    ? customDescription.trim()
    : categoryLabel;

  if (selectedNodes.length === 0) {
    // General issue — no specific device
    return `Troubleshooting request (general — no specific device selected)

Issue category: ${categoryLabel}
User description: ${userDescription}
${customDescription.trim() && category !== 'custom' ? `\nAdditional context: ${customDescription.trim()}` : ''}

Please diagnose this issue and provide step-by-step resolution instructions.
Format each resolution step on its own line, prefixed with a number and period (e.g., "1. Do this first").`;
  }

  const deviceSections = selectedNodes.map((node) => {
    const addr = String(node.address);
    const props = allProperties.get(addr) ?? new Map<string, IsyProperty>();
    const recentLogs = logEntries
      .filter((e) => e.device === addr)
      .slice(0, 10);
    return buildDeviceSection(node, props, recentLogs);
  });

  const header = selectedNodes.length === 1
    ? `Troubleshooting request for device: ${selectedNodes[0]!.name}`
    : `Troubleshooting request for ${selectedNodes.length} devices`;

  return `${header}

${deviceSections.join('\n\n---\n\n')}

Issue category: ${categoryLabel}
User description: ${userDescription}
${customDescription.trim() && category !== 'custom' ? `\nAdditional context: ${customDescription.trim()}` : ''}

Please diagnose this issue and provide step-by-step resolution instructions.
Format each resolution step on its own line, prefixed with a number and period (e.g., "1. Do this first").`;
}

function parseResolutionSteps(diagnosis: string): ResolutionStep[] {
  const steps: ResolutionStep[] = [];
  const lines = diagnosis.split('\n');
  let stepId = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    // Match numbered steps like "1. Do something" or "1) Do something"
    const match = trimmed.match(/^\d+[\.\)]\s+(.+)/);
    if (match) {
      steps.push({ id: stepId++, text: match[1] ?? trimmed, checked: false });
    }
  }

  // If no numbered steps found, treat the whole diagnosis as a single step
  if (steps.length === 0 && diagnosis.trim().length > 0) {
    steps.push({ id: 0, text: diagnosis.trim(), checked: false });
  }

  return steps;
}

/** Group and sort nodes by protocol, then alphabetically by name */
function groupAndSortNodes(nodes: IsyNode[]): GroupedDevices[] {
  const groups = new Map<ProtocolGroup, IsyNode[]>();
  for (const protocol of PROTOCOL_ORDER) {
    groups.set(protocol, []);
  }

  for (const node of nodes) {
    const protocol = getProtocolFamily(String(node.address));
    const group = groups.get(protocol) ?? groups.get('unknown')!;
    group.push(node);
  }

  // Sort each group alphabetically by name
  for (const nodeList of groups.values()) {
    nodeList.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Build result, omitting empty groups
  const result: GroupedDevices[] = [];
  for (const protocol of PROTOCOL_ORDER) {
    const nodeList = groups.get(protocol)!;
    if (nodeList.length > 0) {
      result.push({
        protocol,
        label: PROTOCOL_LABELS[protocol],
        nodes: nodeList,
      });
    }
  }
  return result;
}

// ─── Component ───────────────────────────────────────────────

export function Troubleshooter() {
  // ── Store access ──
  const nodes = useDeviceStore((s) => s.nodes);
  const allProperties = useStatusStore((s) => s.properties);
  const logEntries = useLogStore((s) => s.entries);

  // ── Local state ──
  const [step, setStep] = useState<WizardStep>(1);
  const [category, setCategory] = useState<IssueCategory>('device-not-responding');
  const [selectedAddresses, setSelectedAddresses] = useState<Set<string>>(new Set());
  const [customDescription, setCustomDescription] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [diagnosisError, setDiagnosisError] = useState('');
  const [resolutionSteps, setResolutionSteps] = useState<ResolutionStep[]>([]);
  const [actionResult, setActionResult] = useState('');
  const [actionRunning, setActionRunning] = useState(false);
  const [showReportPanel, setShowReportPanel] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // ── Derived ──
  const selectedNodes = useMemo(
    () => nodes.filter((n) => selectedAddresses.has(String(n.address))),
    [nodes, selectedAddresses],
  );

  const filteredNodes = useMemo(() => {
    if (!deviceFilter.trim()) return nodes;
    const lower = deviceFilter.toLowerCase();
    return nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(lower) ||
        String(n.address).toLowerCase().includes(lower),
    );
  }, [nodes, deviceFilter]);

  const groupedFilteredNodes = useMemo(
    () => groupAndSortNodes(filteredNodes),
    [filteredNodes],
  );

  const categoryLabel = useMemo(
    () => ISSUE_CATEGORIES.find((c) => c.value === category)?.label ?? category,
    [category],
  );

  // Device selection is now optional — only require description for custom category
  const canDiagnose = category !== 'custom' || customDescription.trim().length > 0;

  // ── Selection handlers ──

  const toggleDevice = useCallback((address: string) => {
    setSelectedAddresses((prev) => {
      const next = new Set(prev);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
      }
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedAddresses((prev) => {
      const next = new Set(prev);
      for (const n of filteredNodes) {
        next.add(String(n.address));
      }
      return next;
    });
  }, [filteredNodes]);

  const clearSelection = useCallback(() => {
    setSelectedAddresses(new Set());
  }, []);

  // ── Diagnosis + action handlers ──

  const handleDiagnose = useCallback(async () => {
    if (!canDiagnose) return;

    setDiagnosing(true);
    setDiagnosis('');
    setDiagnosisError('');
    setResolutionSteps([]);
    setStep(2);

    const prompt = buildDiagnosticPrompt(
      selectedNodes,
      allProperties,
      category,
      categoryLabel,
      customDescription,
      logEntries,
    );

    try {
      if (diagnoser) {
        const result = await diagnoser(prompt);
        setDiagnosis(result);
        setResolutionSteps(parseResolutionSteps(result));
        setStep(3);
      } else {
        // No diagnoser registered — offer the prompt for copy
        setDiagnosis(prompt);
        setDiagnosisError(
          'No AI diagnoser registered. Copy the prompt below and paste it into the AI chat panel.',
        );
      }
    } catch (err) {
      setDiagnosisError(
        `Diagnosis failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    } finally {
      setDiagnosing(false);
    }
  }, [selectedNodes, allProperties, category, categoryLabel, customDescription, logEntries, canDiagnose]);

  const handleToggleStep = useCallback((id: number) => {
    setResolutionSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, checked: !s.checked } : s)),
    );
  }, []);

  const handleRequery = useCallback(async () => {
    if (selectedAddresses.size === 0) return;
    setActionRunning(true);
    setActionResult('');
    try {
      const results = await Promise.all(
        [...selectedAddresses].map((addr) => queryNode(addr)),
      );
      const successCount = results.filter(Boolean).length;
      setActionResult(
        successCount === results.length
          ? `Re-queried ${successCount} device${successCount !== 1 ? 's' : ''} successfully.`
          : `Re-queried ${successCount}/${results.length} devices (some failed).`,
      );
    } catch {
      setActionResult('Re-query failed due to a network error.');
    } finally {
      setActionRunning(false);
      setTimeout(() => setActionResult(''), 4000);
    }
  }, [selectedAddresses]);

  const handleClearError = useCallback(async () => {
    setActionRunning(true);
    setActionResult('');
    try {
      const result = await clearLastError();
      setActionResult(result.success ? 'Error state cleared.' : 'Failed to clear error state.');
    } catch {
      setActionResult('Failed to clear error state.');
    } finally {
      setActionRunning(false);
      setTimeout(() => setActionResult(''), 4000);
    }
  }, []);

  const handleCopyPrompt = useCallback(() => {
    if (diagnosis) {
      void navigator.clipboard.writeText(diagnosis);
      setActionResult('Copied to clipboard.');
      setTimeout(() => setActionResult(''), 2000);
    }
  }, [diagnosis]);

  const handleReset = useCallback(() => {
    setStep(1);
    setCategory('device-not-responding');
    setSelectedAddresses(new Set());
    setCustomDescription('');
    setDeviceFilter('');
    setDiagnosis('');
    setDiagnosisError('');
    setResolutionSteps([]);
    setActionResult('');
  }, []);

  const completedSteps = resolutionSteps.filter((s) => s.checked).length;
  const totalSteps = resolutionSteps.length;

  /** Summary label for selected devices (used in steps 2 & 3 headers) */
  const deviceSummary = selectedNodes.length === 0
    ? 'General issue'
    : selectedNodes.length === 1
      ? selectedNodes[0]!.name
      : `${selectedNodes.length} devices`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Troubleshooter
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            AI-powered diagnostic wizard for device issues
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
              showHistory
                ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            <FileText size={14} /> Reports
          </button>
          <button
            onClick={() => setShowReportPanel(true)}
            className="flex items-center gap-1.5 rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Bug size={14} /> Report Issue
          </button>
          {step !== 1 && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <RefreshCw size={14} /> Start Over
            </button>
          )}
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2">
        {([1, 2, 3, 4] as WizardStep[]).map((s) => (
          <button
            key={s}
            onClick={() => {
              if (s < step) setStep(s);
            }}
            disabled={s > step}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              s === step
                ? 'bg-blue-600 text-white'
                : s < step
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50'
                  : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
            }`}
          >
            {s < step ? (
              <CheckCircle2 size={12} />
            ) : (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-current/10 text-[10px]">
                {s}
              </span>
            )}
            {STEP_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Step 1: Describe Issue */}
      {step === 1 && (
        <div className="space-y-4">
          {/* Issue category */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <AlertTriangle size={16} className="text-amber-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                What's the issue?
              </h3>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Issue category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as IssueCategory)}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  {ISSUE_CATEGORIES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {ISSUE_CATEGORIES.find((c) => c.value === category)?.description}
                </p>
              </div>

              {category === 'custom' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Describe the issue
                  </label>
                  <textarea
                    value={customDescription}
                    onChange={(e) => setCustomDescription(e.target.value)}
                    placeholder="Explain what's happening in detail..."
                    rows={3}
                    className="w-full resize-none rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Device selector — searchable checklist */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <Search size={16} className="text-blue-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Select devices
                <span className="ml-1 font-normal text-gray-400">(optional)</span>
              </h3>
              {selectedAddresses.size > 0 && (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                  {selectedAddresses.size} selected
                  <button
                    onClick={clearSelection}
                    className="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
                    title="Clear selection"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
            </div>
            <div className="p-4 space-y-2">
              {/* Search + toolbar */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    value={deviceFilter}
                    onChange={(e) => setDeviceFilter(e.target.value)}
                    placeholder="Search by name or address..."
                    className="w-full rounded border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                  {deviceFilter && (
                    <button
                      onClick={() => setDeviceFilter('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                {filteredNodes.length > 0 && (
                  <button
                    onClick={selectAllFiltered}
                    className="shrink-0 rounded border border-gray-300 px-2 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                    title={deviceFilter ? 'Select all filtered' : 'Select all'}
                  >
                    All
                  </button>
                )}
              </div>

              {/* Selected device chips */}
              {selectedAddresses.size > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedNodes.map((n) => (
                    <button
                      key={String(n.address)}
                      onClick={() => toggleDevice(String(n.address))}
                      className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                    >
                      {n.name}
                      <X size={10} />
                    </button>
                  ))}
                </div>
              )}

              {/* Scrollable device list grouped by protocol */}
              <div className="max-h-72 overflow-y-auto rounded border border-gray-200 dark:border-gray-700">
                {groupedFilteredNodes.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-500">
                    {nodes.length === 0
                      ? 'No devices loaded. Make sure you are connected to the eisy.'
                      : 'No devices match your search.'}
                  </div>
                ) : (
                  groupedFilteredNodes.map((group) => (
                    <div key={group.protocol}>
                      {/* Group header */}
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-1.5 dark:border-gray-800 dark:bg-gray-900/80">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${PROTOCOL_COLORS[group.protocol]}`}>
                          {group.label}
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-600">
                          {group.nodes.length}
                        </span>
                      </div>

                      {/* Device rows */}
                      {group.nodes.map((node) => {
                        const addr = String(node.address);
                        const isSelected = selectedAddresses.has(addr);
                        const typeInfo = getDeviceTypeInfo(
                          node['@_nodeDefId'] ? String(node['@_nodeDefId']) : undefined,
                          node.type ? String(node.type) : undefined,
                        );
                        return (
                          <label
                            key={addr}
                            className={`flex cursor-pointer items-center gap-2.5 border-b border-gray-100 px-3 py-1.5 last:border-b-0 hover:bg-blue-50/50 dark:border-gray-800 dark:hover:bg-blue-900/10 ${
                              isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleDevice(addr)}
                              className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">
                              {node.name}
                            </span>
                            <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-600">
                              {typeInfo.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              <p className="text-[11px] text-gray-400 dark:text-gray-600">
                {filteredNodes.length} device{filteredNodes.length !== 1 ? 's' : ''}
                {deviceFilter && ` matching "${deviceFilter}"`}
                {' '}&#183; Select one or more devices, or skip to diagnose a general issue
              </p>
            </div>
          </div>

          {/* Additional context */}
          {category !== 'custom' && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <ClipboardCheck size={16} className="text-purple-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Additional context
                  <span className="ml-1 font-normal text-gray-400">(optional)</span>
                </h3>
              </div>
              <div className="p-4">
                <textarea
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="Any additional details that might help with diagnosis..."
                  rows={2}
                  className="w-full resize-none rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
            </div>
          )}

          {/* Diagnose button */}
          <button
            onClick={handleDiagnose}
            disabled={!canDiagnose}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Search size={16} />
            Diagnose
            {selectedAddresses.size > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">
                {selectedAddresses.size} device{selectedAddresses.size !== 1 ? 's' : ''}
              </span>
            )}
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Step 2: Diagnosis (shown while diagnosing or if no AI) */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <Wrench size={16} className="text-blue-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Diagnosis
              </h3>
              <span className="ml-auto text-xs text-gray-400">
                {deviceSummary}
              </span>
            </div>
            <div className="p-4">
              {diagnosing && (
                <div className="flex items-center gap-3 py-8">
                  <Loader2 size={20} className="animate-spin text-blue-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {selectedNodes.length > 0
                        ? `Analyzing ${selectedNodes.length} device${selectedNodes.length !== 1 ? 's' : ''}...`
                        : 'Analyzing issue...'}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Sending diagnostic context to AI assistant
                    </p>
                  </div>
                </div>
              )}

              {diagnosisError && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/10 dark:text-amber-400">
                    <p className="font-medium">{diagnosisError}</p>
                  </div>
                  {!diagnoser && diagnosis && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Diagnostic prompt:
                      </p>
                      <pre className="max-h-48 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                        {diagnosis}
                      </pre>
                      <button
                        onClick={handleCopyPrompt}
                        className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <Copy size={14} /> Copy Prompt
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Resolution */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Diagnosis summary */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <Wrench size={16} className="text-blue-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                AI Diagnosis
              </h3>
              <span className="text-xs text-gray-400">
                {deviceSummary}
              </span>
              <button
                onClick={handleCopyPrompt}
                className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Copy diagnosis"
              >
                <Copy size={14} />
              </button>
            </div>
            <div className="p-4">
              <div className="max-h-48 overflow-auto whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                {diagnosis}
              </div>
            </div>
          </div>

          {/* Resolution steps checklist */}
          {resolutionSteps.length > 1 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <CheckCircle2 size={16} className="text-green-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Resolution Steps
                </h3>
                <span className="ml-auto text-xs text-gray-400">
                  {completedSteps}/{totalSteps} completed
                </span>
              </div>

              {/* Progress bar */}
              {totalSteps > 0 && (
                <div className="mx-4 mt-3 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all duration-300"
                    style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
                  />
                </div>
              )}

              <div className="divide-y divide-gray-100 p-2 dark:divide-gray-800">
                {resolutionSteps.map((rs) => (
                  <label
                    key={rs.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/30"
                  >
                    <input
                      type="checkbox"
                      checked={rs.checked}
                      onChange={() => handleToggleStep(rs.id)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 dark:border-gray-600"
                    />
                    <span
                      className={`text-sm ${
                        rs.checked
                          ? 'text-gray-400 line-through dark:text-gray-600'
                          : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {rs.text}
                    </span>
                  </label>
                ))}
              </div>

              {completedSteps === totalSteps && totalSteps > 0 && (
                <div className="mx-4 mb-3 rounded-lg bg-green-50 p-3 text-xs text-green-700 dark:bg-green-900/10 dark:text-green-400">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} />
                    <span className="font-medium">All resolution steps completed.</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <RefreshCw size={16} className="text-purple-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Quick Actions
              </h3>
            </div>
            <div className="space-y-2 p-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleRequery}
                  disabled={actionRunning || selectedAddresses.size === 0}
                  className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <RefreshCw size={14} className={actionRunning ? 'animate-spin' : ''} />
                  Re-query {selectedAddresses.size > 1 ? `${selectedAddresses.size} Devices` : 'Device'}
                </button>
                <button
                  onClick={handleClearError}
                  disabled={actionRunning}
                  className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <AlertTriangle size={14} />
                  Clear Error
                </button>
                <button
                  onClick={handleDiagnose}
                  disabled={diagnosing || !canDiagnose}
                  className="flex items-center gap-1.5 rounded border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20"
                >
                  <Search size={14} />
                  Run Diagnostics Again
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="flex items-center gap-1.5 rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <Bug size={14} />
                  Report Issue
                </button>
              </div>
              {actionResult && (
                <p className="text-xs text-green-600 dark:text-green-400">{actionResult}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Report Issue */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <Bug size={16} className="text-red-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Report Issue
              </h3>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Issue not resolved? Submit a detailed report so the developer can investigate and fix it.
                The AI diagnosis and system data will be included automatically.
              </p>

              {/* Summary of what will be included */}
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Report will include:
                </h4>
                <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
                  <li>&#8226; AI diagnosis and proposed fix</li>
                  {selectedNodes.length > 0 && (
                    <li>&#8226; {selectedNodes.length} affected device{selectedNodes.length !== 1 ? 's' : ''}: {selectedNodes.map((n) => n.name).join(', ')}</li>
                  )}
                  <li>&#8226; Recent log entries (last 20)</li>
                  <li>&#8226; System info (version, device counts, connection state)</li>
                </ul>
              </div>

              <button
                onClick={() => setShowReportPanel(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700"
              >
                <Bug size={16} />
                Review &amp; Submit Report
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issue History (toggled from header) */}
      {showHistory && (
        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          <IssueHistory />
        </div>
      )}

      {/* Issue Report Panel (modal) */}
      {showReportPanel && (
        <IssueReportPanel
          prefill={{
            type: 'bug',
            title: diagnosis ? `${categoryLabel}: ${deviceSummary}` : undefined,
            description: customDescription || undefined,
            aiDiagnosis: diagnosis || undefined,
            category,
            devices: selectedNodes.map((n) => String(n.address)),
            deviceNames: selectedNodes.map((n) => n.name),
          }}
          onClose={() => setShowReportPanel(false)}
          onSubmitted={() => {
            setShowHistory(true);
          }}
        />
      )}
    </div>
  );
}
