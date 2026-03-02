/**
 * KB Capture Engine — automatic Knowledge Base population and
 * AI-powered error troubleshooting.
 *
 * Push architecture: All channels are event-driven, triggered by state
 * changes in Zustand stores. No polling or intervals in this module.
 *
 * Channels:
 *  1. New device detection → product entry + optional AI research
 *  2. Self-healing resolution → troubleshooting entry
 *  3. AI proactive capture → called directly by the AI via system prompt instructions
 *  4. Error pattern detection → AI diagnosis → auto-fix or user notification
 *
 * v2: Product-centric model. Matches devices to specific product models
 * (e.g., "Yale YRD256 Assure Lock SL") instead of generic categories.
 * Uses ProductMatchPattern for multi-strategy device identification.
 */
import { useKnowledgeStore, type ProductProtocol } from '@/stores/knowledge-store.ts';
import { useKBCaptureStore, type NotificationSeverity } from '@/stores/kb-capture-store.ts';
import { useLogStore } from '@/stores/log-store.ts';
import { getDeviceTypeInfo, getZWaveProduct, getZWaveProductName, getModelName } from '@/utils/device-types.ts';
import { getProtocolFamily } from '@/utils/address.ts';
import { queryNode, sendNodeCommand } from '@/api/rest.ts';
import { requestApproval } from '@/stores/action-approval-store.ts';
import type { IsyNode } from '@/api/types.ts';
import type { Incident } from '@/ai/self-healing.ts';
import type { LogEntry } from '@/stores/log-store.ts';

// ─── AI Callback Registration ───────────────────────────────

let kbAICallback: ((prompt: string) => Promise<string>) | null = null;

/**
 * Register the AI callback for KB capture research and troubleshooting.
 * Called once at app startup (in AppShell) to avoid circular deps.
 */
export function registerKBCaptureAI(fn: (prompt: string) => Promise<string>): void {
  kbAICallback = fn;
}

// ─── Budget Guard ────────────────────────────────────────────

const KB_SIZE_LIMIT = 900 * 1024; // 900KB (100KB headroom from 1MB target)

function isOverBudget(): boolean {
  try {
    const exported = useKnowledgeStore.getState().exportAll();
    return new Blob([exported]).size > KB_SIZE_LIMIT;
  } catch {
    return false;
  }
}

// ─── Product Matching ────────────────────────────────────────

/**
 * Find an existing ProductEntry that matches a discovered device.
 *
 * Multi-strategy matching using ProductMatchPattern:
 * 1. Z-Wave mfg triplet exact match (highest confidence)
 * 2. Z-Wave manufacturer-only match (fallback)
 * 3. Insteon nodeDefId pattern match
 * 4. Address prefix match (for node servers, Z-Wave sub-nodes)
 * 5. Protocol-based fallback (last resort)
 */
export function findProductByDevice(
  node: IsyNode,
  nodeDefId?: string,
  deviceAddress?: string,
): string | null {
  const { products } = useKnowledgeStore.getState();
  const addr = deviceAddress ?? String(node.address);
  const def = nodeDefId ?? (node['@_nodeDefId'] ? String(node['@_nodeDefId']) : undefined);
  const defLower = def?.toLowerCase() ?? '';
  const mfgTriplet = node.devtype?.mfg ? String(node.devtype.mfg) : undefined;

  // Strategy 1: Exact Z-Wave mfg triplet match
  if (mfgTriplet) {
    for (const product of products) {
      for (const mp of product.matchPatterns) {
        if (mp.type === 'zwave-mfg' && mp.pattern === mfgTriplet) {
          return product.id;
        }
      }
    }
  }

  // Strategy 2: Z-Wave manufacturer-only match
  if (mfgTriplet) {
    const mfgId = mfgTriplet.split('.')[0]!;
    for (const product of products) {
      for (const mp of product.matchPatterns) {
        if (mp.type === 'zwave-manufacturer' && mp.pattern === mfgId) {
          return product.id;
        }
      }
    }
  }

  // Strategy 3: Insteon nodeDefId pattern match
  if (defLower) {
    for (const product of products) {
      for (const mp of product.matchPatterns) {
        if (mp.type === 'insteon-nodedefid') {
          const patLower = mp.pattern.toLowerCase();
          if (defLower.includes(patLower) || patLower.includes(defLower)) {
            return product.id;
          }
        }
      }
    }
  }

  // Strategy 4: Node server prefix match
  if (/^n\d+/i.test(addr)) {
    for (const product of products) {
      for (const mp of product.matchPatterns) {
        if (mp.type === 'nodeserver-prefix' && addr.toLowerCase().startsWith(mp.pattern.toLowerCase())) {
          return product.id;
        }
      }
    }
  }

  // Strategy 5: Address prefix match (Z-Wave sub-nodes, etc.)
  if (/^z[wylr]\d+/i.test(addr)) {
    const prefix = addr.replace(/_\d+$/, '').toLowerCase();
    for (const product of products) {
      for (const mp of product.matchPatterns) {
        if (mp.type === 'address-prefix') {
          const mpPrefix = mp.pattern.toLowerCase();
          if (prefix === mpPrefix || prefix.startsWith(mpPrefix)) {
            return product.id;
          }
        }
      }
    }
  }

  return null;
}

// ─── Deduplication Helpers ──────────────────────────────────

function isDuplicateContent(content: string): boolean {
  const { documents } = useKnowledgeStore.getState();
  const keywords = extractKeywords(content);
  if (keywords.length === 0) return false;

  for (const doc of documents) {
    const docKeywords = extractKeywords(doc.content);
    if (docKeywords.length === 0) continue;

    const overlap = keywords.filter((kw) => docKeywords.includes(kw)).length;
    const similarity = overlap / Math.max(keywords.length, 1);
    if (similarity > 0.7) return true;
  }

  return false;
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'have', 'will', 'been', 'were', 'they',
    'their', 'which', 'about', 'would', 'could', 'should', 'when', 'what',
    'where', 'your', 'some', 'more', 'than', 'also', 'just', 'like',
  ]);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stopWords.has(w));
  return [...new Set(words)];
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `err_${Math.abs(hash).toString(36)}`;
}

// ─── Notification + Log Helper ──────────────────────────────

function notify(
  message: string,
  severity: NotificationSeverity,
  opts?: { detail?: string; productId?: string; bugReport?: string },
): void {
  useKBCaptureStore.getState().addNotification(message, severity, opts);

  // Persist to log store for history on the Logs page
  void useLogStore.getState().addEntry({
    category: 'comms',
    action: message,
    source: 'kb-capture',
    result: severity === 'error' || severity === 'bug-report' ? 'fail' : 'success',
    detail: opts?.detail ?? opts?.bugReport?.slice(0, 500),
  });

  console.log(`[KB Capture] [${severity}] ${message}`);
}

// ─── Channel 1: New Device Capture ──────────────────────────

export async function captureNewDevice(
  node: IsyNode,
  _nodeMap: Map<string, IsyNode>,
): Promise<void> {
  const store = useKBCaptureStore.getState();
  if (!store.settings.enabled || !store.settings.captureNewDevices) return;

  const address = String(node.address);
  const name = String(node.name);
  const nodeDefId = node['@_nodeDefId'] ? String(node['@_nodeDefId']) : undefined;
  const nodeType = node.type ? String(node.type) : undefined;

  if (store.isRecentlyCaptured(address)) return;
  if (isOverBudget()) return;

  const protocol = getProtocolFamily(address);
  const typeInfo = getDeviceTypeInfo(nodeDefId, nodeType);

  const protocolMap: Record<string, ProductProtocol> = {
    insteon: 'insteon',
    zwave: 'zwave',
    nodeserver: 'other',
  };
  const productProtocol: ProductProtocol = protocolMap[protocol] ?? 'other';

  // Try to match this device to an existing product
  const existingId = findProductByDevice(node, nodeDefId, address);

  if (existingId) {
    // Device type already covered by an existing product — just track it
    store.trackCapture(address);

    // Optionally add AI research if this specific variant isn't documented
    if (store.settings.useAIResearch && kbAICallback && nodeDefId) {
      try {
        const research = await researchDevice(name, nodeDefId, typeInfo.label, productProtocol);
        if (research && !isDuplicateContent(research)) {
          await useKnowledgeStore.getState().addDocument({
            productId: existingId,
            title: `${typeInfo.label}: ${name}`,
            content: research,
          });
          notify(`Added research for ${name}`, 'info', { productId: existingId });
        }
      } catch (err) {
        console.warn('[KB Capture] AI research failed:', err);
      }
    }
    return;
  }

  // No matching product — create a new one for this specific product model
  const productName = buildProductName(node, nodeDefId, nodeType, typeInfo.label, protocol);
  const manufacturer = buildManufacturer(node, protocol);
  const modelNumber = buildModelNumber(node, nodeDefId, protocol);

  const description =
    `${productName}. Protocol: ${productProtocol}.` +
    (typeInfo.hasBattery ? ' Battery-powered.' : ' Mains-powered.') +
    `\n\nAuto-detected from device: ${name} (${address}).` +
    (nodeDefId ? ` NodeDefId: ${nodeDefId}.` : '');

  const matchPatterns = buildMatchPatterns(node, nodeDefId, address, protocol);

  const productId = await useKnowledgeStore.getState().addProduct({
    name: productName,
    manufacturer,
    modelNumber,
    protocol: productProtocol,
    description,
    signalChain: buildSignalChain(productProtocol),
    matchPatterns,
    isExternal: false,
    instanceCount: 1,
    instanceNames: [name],
    tags: buildTags(typeInfo, productProtocol),
    source: 'auto-detected',
  });

  store.trackCapture(address);

  if (store.settings.useAIResearch && kbAICallback) {
    try {
      const research = await researchDevice(name, nodeDefId, typeInfo.label, productProtocol);
      if (research && !isDuplicateContent(research)) {
        await useKnowledgeStore.getState().addDocument({
          productId,
          title: `${productName} — Device Guide`,
          content: research,
        });
      }
    } catch (err) {
      console.warn('[KB Capture] AI research failed:', err);
    }
  }

  notify(`Added product: ${productName}`, 'info', { productId });
}

// ─── Product Name Builders ──────────────────────────────────

function buildProductName(
  node: IsyNode,
  nodeDefId: string | undefined,
  nodeType: string | undefined,
  typeLabel: string,
  protocol: string,
): string {
  // Z-Wave: try exact product name from mfg triplet
  if (protocol === 'zwave' && node.devtype?.mfg) {
    const name = getZWaveProductName(node.devtype, nodeType);
    if (name !== 'Z-Wave Device') return name;
  }

  // Insteon: try known model lookup
  if (protocol === 'insteon' && nodeDefId) {
    const model = getModelName(nodeDefId);
    if (model) return `Insteon ${model}`;
  }

  // Fallback: protocol + type label
  const protocolLabel =
    protocol === 'insteon' ? 'Insteon' :
    protocol === 'zwave' ? 'Z-Wave' :
    protocol === 'nodeserver' ? 'Node Server' : 'Unknown';
  return `${protocolLabel} ${typeLabel}`;
}

function buildManufacturer(node: IsyNode, protocol: string): string {
  if (protocol === 'zwave' && node.devtype?.mfg) {
    const product = getZWaveProduct(String(node.devtype.mfg));
    if (product) return product.manufacturer;
  }
  if (protocol === 'insteon') return 'Insteon';
  return 'Unknown';
}

function buildModelNumber(node: IsyNode, nodeDefId: string | undefined, protocol: string): string {
  if (protocol === 'zwave' && node.devtype?.mfg) {
    const product = getZWaveProduct(String(node.devtype.mfg));
    if (product) return product.model;
  }
  return nodeDefId ?? '';
}

function buildMatchPatterns(
  node: IsyNode,
  nodeDefId: string | undefined,
  address: string,
  protocol: string,
): { type: 'zwave-mfg' | 'zwave-manufacturer' | 'insteon-nodedefid' | 'insteon-type' | 'nodeserver-prefix' | 'address-prefix'; pattern: string }[] {
  const patterns: { type: 'zwave-mfg' | 'zwave-manufacturer' | 'insteon-nodedefid' | 'insteon-type' | 'nodeserver-prefix' | 'address-prefix'; pattern: string }[] = [];

  if (protocol === 'zwave') {
    if (node.devtype?.mfg) {
      patterns.push({ type: 'zwave-mfg', pattern: String(node.devtype.mfg) });
      const mfgId = String(node.devtype.mfg).split('.')[0]!;
      patterns.push({ type: 'zwave-manufacturer', pattern: mfgId });
    }
    // Address prefix for Z-Wave nodes
    const prefix = address.replace(/_\d+$/, '');
    if (/^z[wylr]\d+/i.test(prefix)) {
      patterns.push({ type: 'address-prefix', pattern: prefix });
    }
  } else if (protocol === 'insteon') {
    if (nodeDefId) {
      patterns.push({ type: 'insteon-nodedefid', pattern: nodeDefId });
    }
    if (node.type) {
      // Store "Category.SubCat" (first two segments of the type quad)
      const parts = String(node.type).split('.');
      if (parts.length >= 2) {
        patterns.push({ type: 'insteon-type', pattern: `${parts[0]}.${parts[1]}` });
      }
    }
  } else if (/^n\d+/i.test(address)) {
    // Node server — use the node server prefix
    const nsPrefix = address.replace(/_.+$/, '');
    patterns.push({ type: 'nodeserver-prefix', pattern: nsPrefix });
  }

  return patterns;
}

function buildSignalChain(protocol: ProductProtocol): string[] {
  switch (protocol) {
    case 'insteon': return ['Device (Insteon)', 'Insteon Dual-Band Mesh', 'eisy Hub'];
    case 'zwave':   return ['Device (Z-Wave)', 'Z-Wave Mesh', 'eisy Hub'];
    case 'ir':      return ['Device (IR)', 'IR Signal', 'Flirc USB', 'eisy Hub'];
    default:        return ['Device', 'eisy Hub'];
  }
}

function buildTags(typeInfo: { label: string; hasBattery: boolean; category: string }, protocol: ProductProtocol): string[] {
  const tags: string[] = [protocol];
  if (typeInfo.hasBattery) tags.push('battery-powered');
  else tags.push('mains-powered');
  if (typeInfo.category) tags.push(typeInfo.category);
  // Add type label as tag if it's not redundant
  const labelLower = typeInfo.label.toLowerCase();
  if (!tags.includes(labelLower)) tags.push(labelLower);
  return tags;
}

async function researchDevice(
  name: string,
  nodeDefId: string | undefined,
  deviceType: string,
  protocol: ProductProtocol,
): Promise<string | null> {
  if (!kbAICallback) return null;

  const prompt = `Research this home automation device and provide a brief knowledge base entry.

Device: ${name}
Type: ${deviceType}
Protocol: ${protocol}
${nodeDefId ? `Model/NodeDefId: ${nodeDefId}` : ''}

Please provide a concise summary (200-400 words) covering:
1. **Capabilities** — what this device can do
2. **Configuration tips** — key settings to be aware of
3. **Known quirks** — common issues or behaviors to watch for
4. **Battery info** (if battery-powered) — type, typical lifespan
5. **Useful reference URLs** — official docs or community resources

Format as plain text with section headers. Be specific and practical.
If you're not sure about something, skip it rather than guessing.`;

  try {
    const response = await kbAICallback(prompt);
    return response.trim() || null;
  } catch {
    return null;
  }
}

// ─── Channel 2: Self-Healing Capture ────────────────────────

export async function captureResolvedIncident(incident: Incident): Promise<void> {
  const store = useKBCaptureStore.getState();
  if (!store.settings.enabled || !store.settings.captureSelfHealing) return;
  if (isOverBudget()) return;

  // Build a minimal node-like object for matching
  const fakeNode = { address: incident.deviceAddress, name: incident.deviceName } as IsyNode;
  const productId = findProductByDevice(fakeNode, undefined, incident.deviceAddress);
  if (!productId) {
    console.log('[KB Capture] No product found for device', incident.deviceAddress);
    return;
  }

  const issue = `${incident.deviceName}: ${incident.command} failed — ${incident.error}`;
  const resolution = incident.resolution ??
    (incident.diagnosis ? `Diagnosis: ${incident.diagnosis}` : 'Auto-resolved by self-healing system');

  await useKnowledgeStore.getState().addTroubleshooting({
    productId,
    issue,
    resolution,
  });

  store.trackCapture(incident.deviceAddress);
  notify(`Captured fix for ${incident.deviceName}`, 'resolved', {
    detail: resolution,
    productId,
  });
}

// ─── Channel 3: AI Proactive Knowledge Capture ──────────────
//
// The AI is instructed via system prompt to call this function when
// it learns something valuable (troubleshooting, research, config tips).
// This replaces the old post-hoc conversation mining approach.

/**
 * Capture knowledge directly from the AI assistant.
 * Called when the AI determines it has learned something valuable
 * during a conversation (troubleshooting, external research, etc.).
 */
export async function captureKnowledge(entry: {
  title: string;
  content: string;
  deviceType?: string;
  isTroubleshooting?: boolean;
}): Promise<void> {
  const store = useKBCaptureStore.getState();
  if (!store.settings.enabled) return;
  if (isOverBudget()) return;
  if (isDuplicateContent(entry.content)) return;

  const { products } = useKnowledgeStore.getState();

  // Match by device type name against product names, manufacturers, descriptions
  const matchingProduct = entry.deviceType
    ? products.find((p) =>
        p.name.toLowerCase().includes(entry.deviceType!.toLowerCase()) ||
        p.manufacturer.toLowerCase().includes(entry.deviceType!.toLowerCase()) ||
        p.description.toLowerCase().includes(entry.deviceType!.toLowerCase()),
      )
    : null;

  const productId = matchingProduct?.id ?? products[0]?.id;
  if (!productId) return;

  if (entry.isTroubleshooting) {
    await useKnowledgeStore.getState().addTroubleshooting({
      productId,
      issue: entry.title,
      resolution: entry.content,
    });
  } else {
    await useKnowledgeStore.getState().addDocument({
      productId,
      title: entry.title,
      content: entry.content,
    });
  }

  notify(`Learned: ${entry.title}`, 'info', { productId });
}

// ─── Channel 4: Error Pattern Detection + AI Troubleshooting ─

/**
 * Detect recurring error patterns from logs and optionally use AI
 * to diagnose root causes, attempt fixes, and generate bug reports.
 *
 * Called at app launch (via requestIdleCallback) and once per hour.
 */
export async function detectErrorPatterns(entries: LogEntry[]): Promise<void> {
  const store = useKBCaptureStore.getState();
  if (!store.settings.enabled || !store.settings.captureErrorPatterns) return;
  if (isOverBudget()) return;

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentErrors = entries.filter(
    (e) => e.result === 'fail' && e.timestamp >= cutoff && e.device,
  );

  // Group by device
  const errorsByDevice = new Map<string, LogEntry[]>();
  for (const entry of recentErrors) {
    const device = entry.device!;
    if (!errorsByDevice.has(device)) {
      errorsByDevice.set(device, []);
    }
    errorsByDevice.get(device)!.push(entry);
  }

  for (const [device, errors] of errorsByDevice) {
    if (errors.length < 3) continue;

    const patternKey = `${device}:${errors.map((e) => e.action).sort().join('|')}`;
    const hash = hashString(patternKey);
    if (store.hasErrorHash(hash)) continue;

    const deviceName = errors[0]?.deviceName ?? device;
    const errorSummary = [...new Set(errors.map((e) => e.action))].join('; ');

    // Track hash immediately to prevent re-processing
    store.trackErrorHash(hash);

    if (store.settings.aiErrorTroubleshooting && kbAICallback) {
      await troubleshootErrorPattern(device, deviceName, errors, errorSummary);
    } else {
      // No AI — just log the pattern to KB
      const fakeNode = { address: device, name: deviceName } as IsyNode;
      const productId = findProductByDevice(fakeNode, undefined, device);
      if (productId) {
        await useKnowledgeStore.getState().addTroubleshooting({
          productId,
          issue: `Recurring errors on ${deviceName}: ${errorSummary} (${errors.length} in 24h)`,
          resolution: 'Pattern detected. Check device connectivity and power supply.',
        });
      }
      notify(`Error pattern: ${deviceName}`, 'warning', {
        detail: `${errors.length} errors in 24h: ${errorSummary}`,
      });
    }
  }
}

// ─── AI Error Troubleshooting ───────────────────────────────

interface TroubleshootDiagnosis {
  rootCause: string;
  classification: 'auto-fixable' | 'user-action-needed' | 'app-bug';
  suggestedAction: string;
  autoFixCommand?: string;
  bugReport?: string;
  confidence: number;
}

async function troubleshootErrorPattern(
  deviceAddress: string,
  deviceName: string,
  errors: LogEntry[],
  errorSummary: string,
): Promise<void> {
  if (!kbAICallback) return;

  // Notify that we're investigating
  notify(`Investigating errors on ${deviceName}...`, 'warning', {
    detail: `${errors.length} errors detected: ${errorSummary}`,
  });

  const errorDetails = errors
    .slice(0, 10)
    .map((e) => `  - ${e.action} (${new Date(e.timestamp).toLocaleTimeString()})${e.detail ? `: ${e.detail}` : ''}`)
    .join('\n');

  const prompt = `Diagnose this recurring error pattern on a home automation device.

Device: ${deviceName} (address: ${deviceAddress})
Error count: ${errors.length} in the last 24 hours
Error summary: ${errorSummary}

Recent errors:
${errorDetails}

Classify the issue as one of:
1. "auto-fixable" — Can be resolved by re-querying the device or sending a command
2. "user-action-needed" — Requires physical action (check batteries, reset breaker, etc.)
3. "app-bug" — Indicates a potential software bug (parsing errors, incorrect commands, etc.)

Return a JSON object:
{
  "rootCause": "Brief description of the likely root cause",
  "classification": "auto-fixable" | "user-action-needed" | "app-bug",
  "suggestedAction": "What should be done to fix this",
  "autoFixCommand": "query" | "command:DON" | "command:DOF" | "none",
  "bugReport": "Only for app-bug: detailed description of the suspected issue",
  "confidence": 0.0 to 1.0
}`;

  try {
    const response = await kbAICallback(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      notify(`Could not diagnose errors on ${deviceName}`, 'warning', {
        detail: 'AI response was not parseable',
      });
      return;
    }

    const diagnosis = JSON.parse(jsonMatch[0]) as TroubleshootDiagnosis;

    // Store finding in KB
    const fakeNode = { address: deviceAddress, name: deviceName } as IsyNode;
    const productId = findProductByDevice(fakeNode, undefined, deviceAddress);
    if (productId) {
      await useKnowledgeStore.getState().addTroubleshooting({
        productId,
        issue: `${deviceName}: ${errorSummary} (${errors.length} errors, AI-diagnosed)`,
        resolution: `Root cause: ${diagnosis.rootCause}\nClassification: ${diagnosis.classification}\nAction: ${diagnosis.suggestedAction}`,
      });
    }

    switch (diagnosis.classification) {
      case 'auto-fixable':
        await attemptAutoFix(deviceAddress, deviceName, diagnosis);
        break;

      case 'user-action-needed':
        notify(`Action needed: ${deviceName}`, 'error', {
          detail: `${diagnosis.rootCause}\n\nSuggested action: ${diagnosis.suggestedAction}`,
        });
        break;

      case 'app-bug': {
        const bugReport = generateBugReport(deviceName, deviceAddress, errors, diagnosis);
        notify(`Bug detected affecting ${deviceName}`, 'bug-report', {
          detail: diagnosis.suggestedAction,
          bugReport,
        });
        // Log full bug report
        void useLogStore.getState().addEntry({
          category: 'comms',
          device: deviceAddress,
          deviceName,
          action: `Bug report: ${diagnosis.rootCause}`,
          source: 'kb-capture',
          result: 'fail',
          detail: bugReport,
        });
        break;
      }
    }
  } catch (err) {
    console.warn('[KB Capture] AI troubleshooting failed:', err);
    notify(`Could not diagnose errors on ${deviceName}`, 'warning', {
      detail: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

async function attemptAutoFix(
  deviceAddress: string,
  deviceName: string,
  diagnosis: TroubleshootDiagnosis,
): Promise<void> {
  const cmd = diagnosis.autoFixCommand ?? 'query';

  // ── Approval Gate — user must approve before any device command ──
  const cmdLabel = cmd === 'query' ? `Re-query ${deviceName}` : `Send ${cmd} to ${deviceName}`;
  const approved = await requestApproval({
    description: `Auto-fix: ${cmdLabel}`,
    detail: `Diagnosis: ${diagnosis.rootCause}`,
    source: 'auto-troubleshoot',
    deviceName,
  });
  if (!approved) {
    notify(`Auto-fix denied for ${deviceName}`, 'warning', {
      detail: 'User denied the suggested auto-fix action.',
    });
    return;
  }

  let success = false;

  try {
    if (cmd === 'query') {
      success = await queryNode(deviceAddress);
    } else if (cmd.startsWith('command:')) {
      const command = cmd.split(':')[1]!;
      success = await sendNodeCommand(deviceAddress, command);
    }
  } catch {
    success = false;
  }

  if (success) {
    notify(`Resolved: ${deviceName}`, 'resolved', {
      detail: `Root cause: ${diagnosis.rootCause}\nFix applied: ${diagnosis.suggestedAction}`,
    });
  } else {
    notify(`Could not auto-fix ${deviceName}`, 'error', {
      detail: `Root cause: ${diagnosis.rootCause}\nAuto-fix failed. Suggested: ${diagnosis.suggestedAction}`,
    });
  }
}

function generateBugReport(
  deviceName: string,
  deviceAddress: string,
  errors: LogEntry[],
  diagnosis: TroubleshootDiagnosis,
): string {
  const timestamp = new Date().toISOString();
  const errorList = errors
    .slice(0, 20)
    .map((e) => `  [${new Date(e.timestamp).toISOString()}] ${e.action}${e.detail ? ` — ${e.detail}` : ''}${e.rawCommand ? `\n    Command: ${e.rawCommand}` : ''}`)
    .join('\n');

  return `BUG REPORT
Generated: ${timestamp}
Source: KB Capture Auto-Troubleshooting

DEVICE: ${deviceName} (${deviceAddress})
CLASSIFICATION: Application Bug (confidence: ${Math.round(diagnosis.confidence * 100)}%)

ROOT CAUSE:
${diagnosis.rootCause}

SUGGESTED RESOLUTION:
${diagnosis.suggestedAction}

${diagnosis.bugReport ? `DETAILED ANALYSIS:\n${diagnosis.bugReport}\n` : ''}
ERROR LOG (last ${Math.min(errors.length, 20)} of ${errors.length}):
${errorList}`;
}
