/**
 * AI store — provider config, chat history, API key management.
 * Supports multiple AI providers (Claude, GPT, etc.).
 */
import { create } from 'zustand';

export type AIProvider = 'claude' | 'openai' | 'gemini' | 'custom';

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Tool calls or action cards embedded in assistant messages */
  actions?: AIAction[];
}

export interface AIAction {
  type: 'device-command' | 'program-run' | 'query' | 'suggestion';
  description: string;
  executed: boolean;
  result?: string;
}

export interface AIUsageStats {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number; // USD
}

export interface ModelOption {
  id: string;
  label: string;
}

export type KeyStatus = 'unchecked' | 'checking' | 'valid' | 'invalid';

interface AIState {
  provider: AIProvider;
  apiKey: string;
  model: string;
  proxyUrl: string; // optional backend proxy URL
  messages: AIMessage[];
  isStreaming: boolean;
  usage: AIUsageStats;
  panelOpen: boolean;
  /** Dynamically fetched models per provider (overrides PROVIDER_MODELS when set) */
  fetchedModels: Partial<Record<AIProvider, ModelOption[]>>;
  fetchingModels: boolean;
  /** Whether the current API key has been verified by a successful models fetch */
  keyStatus: KeyStatus;

  setProvider: (provider: AIProvider) => void;
  setApiKey: (key: string) => void;
  setModel: (model: string) => void;
  setProxyUrl: (url: string) => void;
  addMessage: (msg: Omit<AIMessage, 'id' | 'timestamp'>) => void;
  clearMessages: () => void;
  setStreaming: (streaming: boolean) => void;
  addUsage: (input: number, output: number) => void;
  togglePanel: () => void;
  /** Fetch available models from the current provider's API */
  fetchModels: () => Promise<void>;
  /** Get the model list for the current provider (fetched or default) */
  getModels: () => ModelOption[];
  /** Load saved config from localStorage */
  restore: () => void;
}

const STORAGE_KEY = 'eisy-ai-config';

function saveConfig(state: Pick<AIState, 'provider' | 'apiKey' | 'model' | 'proxyUrl'>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage might be unavailable
  }
}

function loadConfig(): Partial<Pick<AIState, 'provider' | 'apiKey' | 'model' | 'proxyUrl'>> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let messageCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

/** Default models per provider */
const DEFAULT_MODELS: Record<AIProvider, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  custom: '',
};

/** Available models per provider */
export const PROVIDER_MODELS: Record<AIProvider, { id: string; label: string }[]> = {
  claude: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash' },
  ],
  custom: [],
};

/** Fetch models from Anthropic API */
async function fetchClaudeModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const models: { id: string; display_name: string; created_at: string }[] = data.data ?? [];
  return models
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((m) => ({ id: m.id, label: m.display_name }));
}

/** Fetch models from OpenAI API — filters to chat-capable models */
async function fetchOpenAIModels(apiKey: string): Promise<ModelOption[]> {
  // Use Vite dev proxy to bypass CORS (OpenAI blocks some browser requests)
  const res = await fetch('/openai-api/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  const models: { id: string }[] = data.data ?? [];
  return models
    .filter((m) => /^(gpt-|o[1-9]|chatgpt-)/.test(m.id) && !m.id.includes('realtime') && !m.id.includes('audio'))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, label: m.id }));
}

/** Fetch models from Gemini API — filters to models that support generateContent */
async function fetchGeminiModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const models: { name: string; displayName: string; supportedGenerationMethods: string[] }[] = data.models ?? [];
  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => ({ id: m.name.replace('models/', ''), label: m.displayName }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Approximate cost per 1K tokens */
const TOKEN_COSTS: Record<AIProvider, { input: number; output: number }> = {
  claude: { input: 0.003, output: 0.015 },
  openai: { input: 0.0025, output: 0.01 },
  gemini: { input: 0.0001, output: 0.0004 },
  custom: { input: 0, output: 0 },
};

export const useAIStore = create<AIState>((set, get) => ({
  provider: 'claude',
  apiKey: '',
  model: DEFAULT_MODELS.claude,
  proxyUrl: '',
  messages: [],
  isStreaming: false,
  usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
  panelOpen: false,
  fetchedModels: {},
  fetchingModels: false,
  keyStatus: 'unchecked',

  setProvider: (provider) => {
    const fetched = get().fetchedModels[provider];
    const model = fetched?.[0]?.id ?? DEFAULT_MODELS[provider];
    set({ provider, model });
    saveConfig({ ...get(), provider, model });
  },

  setApiKey: (apiKey) => {
    set({ apiKey, keyStatus: apiKey ? 'unchecked' : 'unchecked' });
    saveConfig({ ...get(), apiKey });
  },

  setModel: (model) => {
    set({ model });
    saveConfig({ ...get(), model });
  },

  setProxyUrl: (proxyUrl) => {
    set({ proxyUrl });
    saveConfig({ ...get(), proxyUrl });
  },

  addMessage: (msg) => {
    const full: AIMessage = { ...msg, id: nextId(), timestamp: Date.now() };
    set((state) => ({ messages: [...state.messages, full] }));
  },

  clearMessages: () => set({ messages: [] }),
  setStreaming: (isStreaming) => set({ isStreaming }),

  addUsage: (input, output) => {
    const state = get();
    const costs = TOKEN_COSTS[state.provider];
    const newInput = state.usage.inputTokens + input;
    const newOutput = state.usage.outputTokens + output;
    const estimatedCost = (newInput / 1000) * costs.input + (newOutput / 1000) * costs.output;
    set({ usage: { inputTokens: newInput, outputTokens: newOutput, estimatedCost } });
  },

  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),

  fetchModels: async () => {
    const { provider, apiKey } = get();
    if (!apiKey || provider === 'custom') return;

    set({ fetchingModels: true, keyStatus: 'checking' });
    try {
      let models: ModelOption[];
      if (provider === 'claude') {
        models = await fetchClaudeModels(apiKey);
      } else if (provider === 'openai') {
        models = await fetchOpenAIModels(apiKey);
      } else {
        models = await fetchGeminiModels(apiKey);
      }
      if (models.length > 0) {
        set((state) => ({
          fetchedModels: { ...state.fetchedModels, [provider]: models },
          keyStatus: 'valid',
        }));
      } else {
        set({ keyStatus: 'valid' }); // Key works but no models returned
      }
    } catch {
      set({ keyStatus: 'invalid' });
    } finally {
      set({ fetchingModels: false });
    }
  },

  getModels: () => {
    const { provider, fetchedModels } = get();
    return fetchedModels[provider] ?? PROVIDER_MODELS[provider];
  },

  restore: () => {
    const saved = loadConfig();
    if (saved) {
      set({
        provider: saved.provider ?? 'claude',
        apiKey: saved.apiKey ?? '',
        model: saved.model ?? DEFAULT_MODELS[saved.provider ?? 'claude'],
        proxyUrl: saved.proxyUrl ?? '',
      });
    }
  },
}));
