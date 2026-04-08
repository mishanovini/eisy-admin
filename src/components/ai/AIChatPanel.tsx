/**
 * AI Chat Panel — collapsible sidebar for natural-language device control.
 * Supports Claude and OpenAI with tool use for device commands.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  X,
  Send,
  Trash2,
  Settings,
  Bot,
  User,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { useAIStore, type AIProvider } from '@/stores/ai-store.ts';
import { sendChatMessage } from '@/ai/provider.ts';

export function AIChatPanel() {
  const panelOpen = useAIStore((s) => s.panelOpen);
  const togglePanel = useAIStore((s) => s.togglePanel);
  const messages = useAIStore((s) => s.messages);
  const isStreaming = useAIStore((s) => s.isStreaming);
  const addMessage = useAIStore((s) => s.addMessage);
  const clearMessages = useAIStore((s) => s.clearMessages);
  const setStreaming = useAIStore((s) => s.setStreaming);
  const apiKey = useAIStore((s) => s.apiKey);
  const usage = useAIStore((s) => s.usage);

  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Restore AI config on mount
  useEffect(() => {
    useAIStore.getState().restore();
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    addMessage({ role: 'user', content: text });
    setStreaming(true);

    try {
      const response = await sendChatMessage(text);
      addMessage({ role: 'assistant', content: response });
    } catch (err) {
      addMessage({
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
      });
    } finally {
      setStreaming(false);
    }
  }, [input, isStreaming, addMessage, setStreaming]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!panelOpen) {
    return (
      <button
        onClick={togglePanel}
        className="fixed bottom-20 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700"
        title="Open AI Assistant"
      >
        <MessageSquare size={20} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 top-0 z-50 flex w-96 flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <Bot size={20} className="text-blue-500" />
        <h3 className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
          AI Assistant
        </h3>
        {usage.estimatedCost > 0 && (
          <span className="text-xs text-gray-400" title={`${usage.inputTokens} in / ${usage.outputTokens} out`}>
            ${usage.estimatedCost.toFixed(3)}
          </span>
        )}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Settings"
        >
          <Settings size={16} />
        </button>
        <button
          onClick={clearMessages}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Clear chat"
        >
          <Trash2 size={16} />
        </button>
        <button
          onClick={togglePanel}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <X size={16} />
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && <AISettingsInline onClose={() => setShowSettings(false)} />}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !showSettings && (
          <div className="mt-8 text-center">
            <Bot size={36} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Hi! I'm your eisy assistant.
            </p>
            {apiKey ? (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Ask me to control devices, check status, or troubleshoot.
              </p>
            ) : (
              <button
                onClick={() => setShowSettings(true)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
              >
                <Settings size={14} />
                Add your API key to get started
              </button>
            )}
            <div className="mt-4 space-y-1.5">
              {['Turn off all lights', 'What devices have low batteries?', 'Run Front Yard Motion'].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  <ChevronRight size={12} className="flex-shrink-0 text-blue-400" />
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}
          >
            {msg.role === 'assistant' && (
              <Bot size={20} className="mt-0.5 flex-shrink-0 text-blue-500" />
            )}
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
            {msg.role === 'user' && (
              <User size={20} className="mt-0.5 flex-shrink-0 text-gray-400" />
            )}
          </div>
        ))}

        {isStreaming && (
          <div className="flex gap-2">
            <Bot size={20} className="mt-0.5 flex-shrink-0 text-blue-500" />
            <div className="rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800">
              <Loader2 size={16} className="animate-spin text-blue-500" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3 dark:border-gray-700">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={apiKey ? 'Ask me anything...' : 'Set API key in settings first'}
            disabled={!apiKey && !useAIStore.getState().proxyUrl}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 dark:border-gray-600 dark:text-gray-100"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="flex items-center justify-center rounded-lg bg-blue-600 px-3 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Inline settings for AI configuration */
function AISettingsInline({ onClose }: { onClose: () => void }) {
  const provider = useAIStore((s) => s.provider);
  const apiKey = useAIStore((s) => s.apiKey);
  const model = useAIStore((s) => s.model);
  const proxyUrl = useAIStore((s) => s.proxyUrl);
  const fetchingModels = useAIStore((s) => s.fetchingModels);
  const setProvider = useAIStore((s) => s.setProvider);
  const setApiKey = useAIStore((s) => s.setApiKey);
  const setModel = useAIStore((s) => s.setModel);
  const setProxyUrl = useAIStore((s) => s.setProxyUrl);
  const fetchModelsAction = useAIStore((s) => s.fetchModels);
  const getModels = useAIStore((s) => s.getModels);
  const usage = useAIStore((s) => s.usage);

  const models = getModels();
  const canFetchModels = provider !== 'custom' && apiKey.length > 0;

  return (
    <div className="border-b border-gray-200 bg-gray-50 p-3 space-y-3 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">AI Settings</h4>
        <button onClick={onClose} className="text-xs text-blue-500 hover:text-blue-600">Done</button>
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Provider</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as AIProvider)}
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="claude">Anthropic (Claude)</option>
          <option value="openai">OpenAI (GPT)</option>
          <option value="gemini">Google (Gemini)</option>
          <option value="custom">Custom Proxy</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider === 'claude' ? 'sk-ant-...' : provider === 'gemini' ? 'AIza...' : 'sk-...'}
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs text-gray-500 dark:text-gray-400">Model</label>
          {canFetchModels && (
            <button
              onClick={fetchModelsAction}
              disabled={fetchingModels}
              className="text-xs text-blue-500 hover:text-blue-600 disabled:opacity-50"
            >
              {fetchingModels ? 'Fetching...' : 'Refresh'}
            </button>
          )}
        </div>
        {models.length > 0 ? (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
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
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        )}
      </div>

      {provider === 'custom' && (
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Proxy URL</label>
          <input
            type="text"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="https://your-proxy.com/api/chat"
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      )}

      {usage.estimatedCost > 0 && (
        <div className="rounded bg-gray-100 p-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          Session: {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out — ${usage.estimatedCost.toFixed(4)}
        </div>
      )}
    </div>
  );
}
