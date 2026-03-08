/**
 * Multi-provider AI abstraction — Claude, OpenAI, and Gemini with tool/function calling.
 * Handles streaming responses and tool execution loops.
 */
import { useAIStore } from '@/stores/ai-store.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import { getToolDefinitions, executeTool, type ToolDef } from './tools.ts';
import { boolAttr } from '@/utils/xml-parser.ts';
import { getDeviceTypeInfo } from '@/utils/device-types.ts';

/** Build the system prompt with full environment context */
function buildSystemPrompt(): string {
  const devices = useDeviceStore.getState();
  const programs = useProgramStore.getState();

  // Summarize device inventory
  const typeCount: Record<string, number> = {};
  for (const n of devices.nodes) {
    const t = getDeviceTypeInfo(n['@_nodeDefId'], n.type ? String(n.type) : undefined).label;
    typeCount[t] = (typeCount[t] ?? 0) + 1;
  }
  const deviceSummary = Object.entries(typeCount).map(([t, c]) => `${c} ${t}s`).join(', ');

  // List all device names for resolution
  const deviceNames = devices.nodes.slice(0, 150).map((n) => n.name).join(', ');

  // Program summary
  const progCount = programs.programs.filter((p) => !boolAttr(p['@_folder'])).length;
  const enabledCount = programs.programs.filter((p) => boolAttr(p['@_enabled']) && !boolAttr(p['@_folder'])).length;

  return `You are a smart home assistant for the Universal Devices eisy controller (IoX platform).

ENVIRONMENT:
- ${devices.nodes.length} devices: ${deviceSummary}
- ${progCount} programs (${enabledCount} enabled)
- Protocols: Insteon, Z-Wave, IR

DEVICE NAMES (for resolution):
${deviceNames}

CAPABILITIES:
- Control devices (on/off, dim, lock/unlock)
- Run/stop programs
- Query device status and battery levels
- Provide troubleshooting help
- Capture knowledge to the Knowledge Base for future reference

GUIDELINES:
- Always confirm before executing destructive actions (unlock doors, disable programs)
- Use exact device names when calling tools
- Be concise but helpful
- If a device name is ambiguous, ask for clarification
- Report results clearly after executing commands

KNOWLEDGE CAPTURE:
You have a "capture_knowledge" tool. Use it proactively to save valuable information to the Knowledge Base when:
1. You troubleshoot and resolve a device issue — capture the issue and resolution steps
2. You research a device type, protocol, or configuration — capture what you learned
3. You discover a workaround for a quirk or limitation — capture it for future reference
4. The user shares useful configuration tips or explains how their setup works — capture it
5. You look up external information about a device or integration — capture a summary

When capturing, write clear, reusable content that would help someone encountering the same situation later. Set isTroubleshooting=true for issue/resolution pairs. Include the device type when relevant so the entry gets linked to the correct integration profile.

Do NOT capture trivial information like "turned on a light" — only capture knowledge that has lasting reference value.

ISSUE REPORTING:
You have a "file_issue_report" tool. Use it when:
1. You identify an issue that requires a code change to the Super eisy app itself (not a device configuration change or user action)
2. The user explicitly asks to report a bug or request a feature
3. You diagnose a problem but realize the fix needs to happen in the app's source code

When filing a report, include a specific technical diagnosis and proposed code fix — be as detailed as possible so the developer knows exactly what to change. The report is saved as a draft that the user can review before submission.`;
}

/** Convert our tool definitions to Claude API format */
function toClaudeTools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/** Convert our tool definitions to OpenAI API format */
function toOpenAITools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Convert our tool definitions to Gemini API format */
function toGeminiTools(tools: ToolDef[]): unknown[] {
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  }];
}

/** Chat message format for API calls */
interface ChatMsg {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Send a chat message and get a response, handling tool calls */
export async function sendChatMessage(userMessage: string): Promise<string> {
  const store = useAIStore.getState();
  const { provider, apiKey, model, proxyUrl } = store;

  if (!apiKey && !proxyUrl) {
    return 'Please configure your AI API key in Settings first.';
  }

  // Build conversation history
  const systemPrompt = buildSystemPrompt();
  const history: ChatMsg[] = store.messages.slice(-20).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
  history.push({ role: 'user', content: userMessage });

  const tools = getToolDefinitions();

  try {
    if (provider === 'claude') {
      return await callClaude(systemPrompt, history, tools, apiKey, model, proxyUrl);
    } else if (provider === 'openai') {
      return await callOpenAI(systemPrompt, history, tools, apiKey, model, proxyUrl);
    } else if (provider === 'gemini') {
      return await callGemini(systemPrompt, history, tools, apiKey, model, proxyUrl);
    } else {
      return await callCustom(systemPrompt, history, tools, proxyUrl);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    // Provide specific, helpful error messages based on the actual failure
    if (msg.includes('401')) {
      return 'Authentication failed (HTTP 401). Please check your API key in Settings.';
    }
    if (msg.includes('403')) {
      return 'Access denied (HTTP 403). Your API key may not have permission for this model or endpoint.';
    }
    if (msg.includes('429')) {
      return 'Rate limit exceeded (HTTP 429). Please wait a moment and try again.';
    }
    if (msg.includes('400')) {
      return `Bad request (HTTP 400). The selected model may not support this request format. Try a different model.`;
    }
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
      if (import.meta.env.PROD && provider === 'openai') {
        return 'OpenAI blocks browser CORS requests to their chat API. When running from the eisy, use Claude or Gemini instead (both support browser access), or configure a custom proxy URL in Settings.';
      }
      return `Network error: Could not reach the ${provider} API. This may be a CORS restriction with browser-based access.`;
    }
    if (msg.includes('404')) {
      return `Model not found (HTTP 404). The model "${model}" may not be available. Try selecting a different model in Settings.`;
    }
    return `Error: ${msg}`;
  }
}

/** Call Claude API with tool use */
async function callClaude(
  system: string,
  messages: ChatMsg[],
  tools: ToolDef[],
  apiKey: string,
  model: string,
  proxyUrl: string,
): Promise<string> {
  const url = proxyUrl || 'https://api.anthropic.com/v1/messages';

  // Convert messages to Claude format (no system role in messages)
  const claudeMessages = messages.map((m) => ({
    role: m.role === 'system' ? 'user' : m.role,
    content: m.content,
  }));

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 2048,
      system,
      messages: claudeMessages,
      tools: toClaudeTools(tools),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    let detail = '';
    try {
      const parsed = JSON.parse(errorBody);
      detail = parsed?.error?.message || parsed?.message || '';
    } catch { /* not JSON */ }
    throw new Error(`Claude API error: ${response.status}${detail ? ` — ${detail}` : ''}`);
  }

  let data = await response.json();
  let textParts: string[] = [];
  let iterations = 0;

  // Tool use loop — Claude may request tool calls
  while (iterations < 5) {
    iterations++;
    let hasToolUse = false;

    for (const block of data.content ?? []) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        hasToolUse = true;
        const result = await executeTool(block.name, block.input);
        textParts.push(`\n*${result.message}*\n`);

        // Track usage
        useAIStore.getState().addUsage(data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0);

        // Continue conversation with tool result
        claudeMessages.push({ role: 'assistant', content: data.content });
        claudeMessages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: block.id, content: result.message }] as unknown as string,
        });

        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: model || 'claude-sonnet-4-6',
            max_tokens: 2048,
            system,
            messages: claudeMessages,
            tools: toClaudeTools(tools),
          }),
        });

        if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
        data = await response.json();
        break; // Restart the content block loop with new data
      }
    }

    if (!hasToolUse) break;
  }

  // Track final usage
  useAIStore.getState().addUsage(data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0);

  return textParts.join('').trim() || 'Done.';
}

/** Call OpenAI API with function calling */
async function callOpenAI(
  system: string,
  messages: ChatMsg[],
  tools: ToolDef[],
  apiKey: string,
  model: string,
  proxyUrl: string,
): Promise<string> {
  // Dev: Vite proxy. Prod: try direct (CORS may block chat/completions).
  // Users can specify a custom proxy URL in settings to work around this.
  const defaultUrl = import.meta.env.DEV
    ? '/openai-api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const url = proxyUrl || defaultUrl;

  const openaiMessages = [
    { role: 'system', content: system },
    ...messages,
  ];

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      messages: openaiMessages,
      tools: toOpenAITools(tools),
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    let detail = '';
    try {
      const parsed = JSON.parse(errorBody);
      detail = parsed?.error?.message || parsed?.message || '';
    } catch { /* not JSON */ }
    throw new Error(`OpenAI API error: ${response.status}${detail ? ` — ${detail}` : ''}`);
  }

  let data = await response.json();
  let textParts: string[] = [];
  let iterations = 0;

  while (iterations < 5) {
    iterations++;
    const choice = data.choices?.[0];
    if (!choice) break;

    if (choice.message?.content) {
      textParts.push(choice.message.content);
    }

    const toolCalls = choice.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason !== 'tool_calls') break;

    // Execute tool calls
    openaiMessages.push(choice.message);
    for (const tc of toolCalls) {
      const args = JSON.parse(tc.function.arguments);
      const result = await executeTool(tc.function.name, args);
      textParts.push(`\n*${result.message}*\n`);
      openaiMessages.push({
        role: 'tool' as 'system',
        content: result.message,
        tool_call_id: tc.id,
      } as unknown as ChatMsg);
    }

    // Track usage
    useAIStore.getState().addUsage(data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0);

    // Continue conversation
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: openaiMessages,
        tools: toOpenAITools(tools),
        max_tokens: 2048,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
    data = await response.json();
  }

  useAIStore.getState().addUsage(data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0);

  return textParts.join('').trim() || 'Done.';
}

/** Call Gemini API with function calling */
async function callGemini(
  system: string,
  messages: ChatMsg[],
  tools: ToolDef[],
  apiKey: string,
  model: string,
  proxyUrl: string,
): Promise<string> {
  const modelId = model || 'gemini-2.0-flash';
  const url = proxyUrl || `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  // Convert messages to Gemini format
  const geminiContents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  let response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: geminiContents,
      tools: toGeminiTools(tools),
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  let data = await response.json();
  let textParts: string[] = [];
  let iterations = 0;

  while (iterations < 5) {
    iterations++;
    const candidate = data.candidates?.[0];
    if (!candidate) break;

    let hasFunctionCall = false;
    const functionResponses: { name: string; response: { result: string } }[] = [];

    for (const part of candidate.content?.parts ?? []) {
      if (part.text) {
        textParts.push(part.text);
      } else if (part.functionCall) {
        hasFunctionCall = true;
        const result = await executeTool(part.functionCall.name, part.functionCall.args ?? {});
        textParts.push(`\n*${result.message}*\n`);
        functionResponses.push({
          name: part.functionCall.name,
          response: { result: result.message },
        });
      }
    }

    // Track usage
    const usage = data.usageMetadata;
    if (usage) {
      useAIStore.getState().addUsage(usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0);
    }

    if (!hasFunctionCall) break;

    // Continue conversation with function results
    geminiContents.push(candidate.content);
    geminiContents.push({
      role: 'user',
      parts: functionResponses.map((fr) => ({ functionResponse: fr })) as unknown as { text: string }[],
    });

    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: geminiContents,
        tools: toGeminiTools(tools),
      }),
    });

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
    data = await response.json();
  }

  return textParts.join('').trim() || 'Done.';
}

/** Call a custom/proxy endpoint */
async function callCustom(
  system: string,
  messages: ChatMsg[],
  tools: ToolDef[],
  proxyUrl: string,
): Promise<string> {
  if (!proxyUrl) return 'Custom provider requires a proxy URL.';

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages, tools }),
  });

  if (!response.ok) throw new Error(`Proxy error: ${response.status}`);
  const data = await response.json();
  return data.message ?? data.content ?? JSON.stringify(data);
}
