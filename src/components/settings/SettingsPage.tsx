/**
 * Settings page — AI configuration, connection info, and system management.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Bot,
  Wifi,
  Info,
  Key,
  RefreshCw,
  Shield,
  Trash2,
  Mail,
  Mic,
  Github,
  Linkedin,
  Code2,
  User,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import { useAIStore, type AIProvider } from '@/stores/ai-store.ts';
import { useConnectionStore } from '@/stores/connection-store.ts';
import { useLogStore } from '@/stores/log-store.ts';
import { clearLastError, queryAll } from '@/api/soap.ts';
import { BackupRestore } from './BackupRestore.tsx';
import { NotificationSettings } from './NotificationSettings.tsx';
import { KBCaptureSettings } from './KBCaptureSettings.tsx';
import { PortalConnection } from './PortalConnection.tsx';
import { PortalSpokenList } from './PortalSpokenList.tsx';
import { PortalRoomManager } from './PortalRoomManager.tsx';
import { PortalActivityLog } from './PortalActivityLog.tsx';
import { usePortalStore } from '@/stores/portal-store.ts';
import { ConfirmDialog } from '@/components/common/ConfirmDialog.tsx';
import { useConfirm } from '@/hooks/useConfirm.ts';

// ─── Provider configuration for API key links and status pages ───

interface ProviderInfo {
  label: string;
  apiKeyUrl: string;
  apiKeyLabel: string;
  statusPageUrl: string;
  /** Atlassian Statuspage API summary endpoint (Claude/OpenAI use Statuspage) */
  statusApiUrl?: string;
  /** Component name to look for in the Statuspage summary */
  statusComponent?: string;
  /** Google-specific: product ID for incidents filtering */
  googleProductId?: string;
}

const PROVIDER_INFO: Record<string, ProviderInfo> = {
  claude: {
    label: 'Anthropic',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    apiKeyLabel: 'Anthropic Console → API Keys',
    statusPageUrl: 'https://status.claude.com',
    statusApiUrl: 'https://status.claude.com/api/v2/summary.json',
    statusComponent: 'Claude API',
  },
  openai: {
    label: 'OpenAI',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    apiKeyLabel: 'OpenAI Platform → API Keys',
    statusPageUrl: 'https://status.openai.com',
    statusApiUrl: 'https://status.openai.com/api/v2/summary.json',
    statusComponent: 'Chat Completions',
  },
  gemini: {
    label: 'Google',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    apiKeyLabel: 'Google AI Studio → API Keys',
    statusPageUrl: 'https://status.cloud.google.com',
  },
};

type StatusLevel = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'unknown' | 'loading';

const STATUS_COLORS: Record<StatusLevel, string> = {
  operational: 'bg-green-500',
  degraded: 'bg-yellow-500',
  partial_outage: 'bg-orange-500',
  major_outage: 'bg-red-500',
  unknown: 'bg-gray-400',
  loading: 'bg-gray-300 animate-pulse',
};

const STATUS_LABELS: Record<StatusLevel, string> = {
  operational: 'Operational',
  degraded: 'Degraded Performance',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  unknown: 'Status Unknown',
  loading: 'Checking...',
};

/**
 * Fetches the operational status of the currently selected AI provider.
 * Uses Atlassian Statuspage API (Claude, OpenAI) which supports CORS.
 * For Gemini, we'd need Google Cloud Status API which doesn't support CORS,
 * so we show a link to the status page instead.
 */
function useProviderStatus(provider: string): { status: StatusLevel; description: string } {
  const [status, setStatus] = useState<StatusLevel>('loading');
  const [description, setDescription] = useState('');

  const fetchStatus = useCallback(async () => {
    const info = PROVIDER_INFO[provider];
    if (!info?.statusApiUrl) {
      setStatus('unknown');
      setDescription('Check status page for details');
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(info.statusApiUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!resp.ok) {
        setStatus('unknown');
        setDescription(`Status API returned ${resp.status}`);
        return;
      }

      const data = await resp.json();

      // Atlassian Statuspage response: { components: [{ name, status }], status: { description } }
      const components: { name: string; status: string }[] = data.components ?? [];
      const match = components.find((c) =>
        c.name === info.statusComponent || c.name.startsWith(info.statusComponent ?? ''),
      );

      if (match) {
        // Map Atlassian status values to our levels
        const map: Record<string, StatusLevel> = {
          operational: 'operational',
          degraded_performance: 'degraded',
          partial_outage: 'partial_outage',
          major_outage: 'major_outage',
        };
        setStatus(map[match.status] ?? 'unknown');
        setDescription(`${match.name}: ${match.status.replace(/_/g, ' ')}`);
      } else {
        // Fallback to overall page status
        const overall = data.status?.indicator;
        if (overall === 'none') {
          setStatus('operational');
          setDescription(data.status?.description ?? 'All systems operational');
        } else {
          setStatus(overall === 'minor' ? 'degraded' : overall === 'major' ? 'major_outage' : 'unknown');
          setDescription(data.status?.description ?? '');
        }
      }
    } catch {
      setStatus('unknown');
      setDescription('Could not reach status API');
    }
  }, [provider]);

  useEffect(() => {
    setStatus('loading');
    setDescription('');
    fetchStatus();

    // Refresh every 5 minutes
    const interval = setInterval(fetchStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { status, description };
}

type Tab = 'ai' | 'voice' | 'notifications' | 'connection' | 'about';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('ai');

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Settings</h1>

      {/* Tab bar */}
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
        {([
          { id: 'ai' as Tab, label: 'AI Assistant', icon: <Bot size={14} /> },
          { id: 'voice' as Tab, label: 'Voice Control', icon: <Mic size={14} /> },
          { id: 'notifications' as Tab, label: 'Notifications', icon: <Mail size={14} /> },
          { id: 'connection' as Tab, label: 'Connection', icon: <Wifi size={14} /> },
          { id: 'about' as Tab, label: 'About', icon: <Info size={14} /> },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'ai' && <AISettingsTab />}
      {tab === 'voice' && <VoiceControlTab />}
      {tab === 'notifications' && <NotificationSettings />}
      {tab === 'connection' && <ConnectionTab />}
      {tab === 'about' && <AboutTab />}
    </div>
  );
}

/* ─── AI Settings Tab ────────────────────────────────────── */

function AISettingsTab() {
  const provider = useAIStore((s) => s.provider);
  const apiKey = useAIStore((s) => s.apiKey);
  const model = useAIStore((s) => s.model);
  const proxyUrl = useAIStore((s) => s.proxyUrl);
  const usage = useAIStore((s) => s.usage);
  const fetchingModels = useAIStore((s) => s.fetchingModels);
  const keyStatus = useAIStore((s) => s.keyStatus);
  const setProvider = useAIStore((s) => s.setProvider);
  const setApiKey = useAIStore((s) => s.setApiKey);
  const setModel = useAIStore((s) => s.setModel);
  const setProxyUrl = useAIStore((s) => s.setProxyUrl);
  const fetchModels = useAIStore((s) => s.fetchModels);
  const getModels = useAIStore((s) => s.getModels);

  const models = getModels();
  const canFetchModels = provider !== 'custom' && apiKey.length > 0;
  const providerInfo = PROVIDER_INFO[provider];
  const { status: providerStatus, description: statusDescription } = useProviderStatus(provider);

  // Auto-validate API key when it changes (debounced)
  useEffect(() => {
    if (!apiKey || provider === 'custom') return;
    const timer = setTimeout(() => {
      fetchModels();
    }, 800); // Wait 800ms after user stops typing
    return () => clearTimeout(timer);
  }, [apiKey, provider, fetchModels]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-blue-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Provider</h3>
          </div>
          {/* Provider status indicator */}
          {provider !== 'custom' && (
            <a
              href={providerInfo?.statusPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title={statusDescription || STATUS_LABELS[providerStatus]}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[providerStatus]}`} />
              <span>{STATUS_LABELS[providerStatus]}</span>
            </a>
          )}
        </div>
        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as AIProvider)}
              className="w-full max-w-sm rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="claude">Anthropic (Claude)</option>
              <option value="openai">OpenAI (GPT)</option>
              <option value="gemini">Google (Gemini)</option>
              <option value="custom">Custom Proxy</option>
            </select>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">API Key</label>
              {providerInfo && (
                <a
                  href={providerInfo.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600"
                >
                  <ExternalLink size={11} />
                  {providerInfo.apiKeyLabel}
                </a>
              )}
            </div>
            <input
              type="password"
              name="ai-api-key"
              autoComplete="ai-api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'claude' ? 'sk-ant-api03-...' : provider === 'gemini' ? 'AIza...' : 'sk-...'}
              className={`w-full max-w-sm rounded border px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100 ${
                keyStatus === 'valid'
                  ? 'border-green-400 bg-green-50/50 dark:border-green-600 dark:bg-green-900/10'
                  : keyStatus === 'invalid'
                    ? 'border-red-400 bg-red-50/50 dark:border-red-600 dark:bg-red-900/10'
                    : 'border-gray-300 bg-white dark:border-gray-600'
              }`}
            />
            {/* Key validation status */}
            <div className="mt-1 flex items-center gap-1.5">
              {keyStatus === 'checking' && (
                <span className="flex items-center gap-1 text-xs text-blue-500">
                  <Loader2 size={12} className="animate-spin" /> Verifying key...
                </span>
              )}
              {keyStatus === 'valid' && (
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <CheckCircle2 size={12} /> API key verified — {models.length} models available
                </span>
              )}
              {keyStatus === 'invalid' && apiKey && (
                <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                  <XCircle size={12} /> Invalid API key — could not fetch models
                </span>
              )}
              {keyStatus === 'unchecked' && apiKey && (
                <span className="text-xs text-gray-400">Stored in localStorage. Do not use on shared computers.</span>
              )}
              {!apiKey && (
                <span className="text-xs text-gray-400">Stored in localStorage. Do not use on shared computers.</span>
              )}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Model</label>
              {canFetchModels && (
                <button
                  onClick={fetchModels}
                  disabled={fetchingModels}
                  className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 disabled:opacity-50"
                >
                  <RefreshCw size={12} className={fetchingModels ? 'animate-spin' : ''} />
                  {fetchingModels ? 'Fetching...' : 'Refresh models'}
                </button>
              )}
            </div>
            {models.length > 0 ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full max-w-sm rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model identifier"
                className="w-full max-w-sm rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            )}
          </div>

          {provider === 'custom' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Proxy URL</label>
              <input
                type="text"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="https://your-proxy.com/api/chat"
                className="w-full max-w-sm rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          )}
        </div>
      </div>

      {/* Usage Stats */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Bot size={16} className="text-green-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Session Usage</h3>
        </div>
        <div className="space-y-2 p-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Input tokens</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{usage.inputTokens.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Output tokens</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{usage.outputTokens.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Estimated cost</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">${usage.estimatedCost.toFixed(4)}</span>
          </div>
        </div>
      </div>

      {/* KB Auto-Capture Settings */}
      <KBCaptureSettings />
    </div>
  );
}

/* ─── Voice Control Tab ─────────────────────────────────── */

function VoiceControlTab() {
  const portalStatus = usePortalStore((s) => s.status);

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-2">
      {/* Portal connection — collapsible when connected (small banner) */}
      <div className="shrink-0">
        <PortalConnection />
      </div>

      {portalStatus === 'connected' && (
        <>
          {/* Spoken entries — takes remaining space, scrolls internally */}
          <PortalSpokenList />

          {/* Rooms — compact, collapsed by default */}
          <div className="shrink-0">
            <PortalRoomManager />
          </div>

          {/* Activity log — small footer with internal scroll */}
          <div className="shrink-0">
            <PortalActivityLog />
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Connection Tab ─────────────────────────────────────── */

function ConnectionTab() {
  const host = useConnectionStore((s) => s.host);
  const port = useConnectionStore((s) => s.port);
  const status = useConnectionStore((s) => s.status);
  const config = useConnectionStore((s) => s.config);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const [actionResult, setActionResult] = useState('');
  const [dialogProps, confirm] = useConfirm();

  const handleClearErrors = async () => {
    const result = await clearLastError();
    setActionResult(result.success ? 'Errors cleared' : 'Failed to clear errors');
    setTimeout(() => setActionResult(''), 3000);
  };

  const handleQueryAll = async () => {
    setActionResult('Querying all devices...');
    const result = await queryAll();
    setActionResult(result.success ? 'Query sent to all devices' : 'Query failed');
    setTimeout(() => setActionResult(''), 3000);
  };

  const handleDisconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect from eisy?',
      message: 'This will close the connection and return to the login screen. Any unsaved changes will be lost.',
      confirmLabel: 'Disconnect',
      variant: 'danger',
    });
    if (ok) disconnect();
  };

  return (
    <div className="space-y-6">
      <ConfirmDialog {...dialogProps} />

      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Wifi size={16} className="text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Connection</h3>
        </div>
        <div className="space-y-2 p-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Host</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{host}:{port}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Status</span>
            <span className={`font-medium ${status === 'connected' ? 'text-green-600' : 'text-red-600'}`}>{status}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Platform</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{config?.platform ?? '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Firmware</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{config?.app_full_version ?? config?.app_version ?? '—'}</span>
          </div>
        </div>
      </div>

      {/* System actions */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Shield size={16} className="text-amber-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">System Actions</h3>
        </div>
        <div className="space-y-2 p-4">
          <div className="flex flex-wrap gap-2">
            <button onClick={handleQueryAll} className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
              <RefreshCw size={14} /> Query All Devices
            </button>
            <button onClick={handleClearErrors} className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
              <Trash2 size={14} /> Clear Errors
            </button>
            <button onClick={handleDisconnect} className="flex items-center gap-1.5 rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20">
              <Wifi size={14} /> Disconnect
            </button>
          </div>
          {actionResult && (
            <p className="text-xs text-green-600 dark:text-green-400">{actionResult}</p>
          )}
        </div>
      </div>

      <BackupRestore />
    </div>
  );
}

/* ─── About Tab ──────────────────────────────────────────── */

function AboutTab() {
  const purgeOld = useLogStore((s) => s.purgeOld);
  const [purged, setPurged] = useState<number | null>(null);
  const [dialogProps, confirm] = useConfirm();

  const handlePurge = async () => {
    const ok = await confirm({
      title: 'Purge old logs?',
      message: 'This will permanently delete all log entries older than 30 days. This cannot be undone.',
      confirmLabel: 'Purge',
      variant: 'danger',
    });
    if (!ok) return;
    const n = await purgeOld();
    setPurged(n);
    setTimeout(() => setPurged(null), 3000);
  };

  return (
    <div className="space-y-6">
      <ConfirmDialog {...dialogProps} />

      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Info size={16} className="text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">About Super eisy</h3>
        </div>
        <div className="space-y-3 p-4 text-sm">
          <p className="text-gray-700 dark:text-gray-300">
            Open-source web console for the Universal Devices eisy (IoX) controller.
            Replaces the legacy Java Admin Console with a modern web interface.
          </p>
          <div className="space-y-1 text-gray-500 dark:text-gray-400">
            <p>Version: 0.1.0</p>
            <p>License: MIT</p>
            <p>Stack: React + TypeScript + Tailwind + Zustand</p>
          </div>

          {/* Developer */}
          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              <User size={14} className="text-blue-500" />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Developed by Misha Novini</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <a
                href="https://www.linkedin.com/in/mishanovini"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
              >
                <Linkedin size={12} /> LinkedIn
              </a>
              <a
                href="https://github.com/mnovini/eisy-admin"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-gray-600 hover:underline dark:text-gray-400"
              >
                <Github size={12} /> GitHub Repo
              </a>
            </div>
            <p className="mt-2 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <Code2 size={11} /> Built with{' '}
              <a
                href="https://claude.ai/claude-code"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-600 hover:underline dark:text-orange-400"
              >
                Claude Code
              </a>
              {' '}by Anthropic
            </p>
          </div>

          <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/10 dark:text-amber-400">
            <p className="font-medium">Disclaimers</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>Not affiliated with Universal Devices Inc.</li>
              <li>Tested on Insteon + Z-Wave + IR devices only</li>
              <li>AI features require your own API key (usage costs apply)</li>
              <li>eisy and ISY Portal (my.isy.io) credentials are stored in browser localStorage — do not use on shared computers</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Trash2 size={16} className="text-red-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Data Management</h3>
        </div>
        <div className="space-y-2 p-4">
          <button
            onClick={handlePurge}
            className="flex items-center gap-1.5 rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Trash2 size={14} /> Purge Logs Older Than 30 Days
          </button>
          {purged !== null && (
            <p className="text-xs text-green-600 dark:text-green-400">Purged {purged} old entries</p>
          )}
        </div>
      </div>
    </div>
  );
}
