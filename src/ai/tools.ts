/**
 * AI tool definitions — device control, queries, and program management.
 * These map to REST/SOAP operations and give the AI the ability to control the eisy.
 */
import { sendNodeCommand, queryNode } from '@/api/rest.ts';
import { runProgram, runProgramElse, stopProgram } from '@/api/rest.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { boolAttr } from '@/utils/xml-parser.ts';
import { useStatusStore } from '@/stores/status-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import { getDeviceTypeInfo } from '@/utils/device-types.ts';
import { formatPropertyValue, formatPropertyName } from '@/utils/labels.ts';
import { captureKnowledge } from '@/ai/kb-capture.ts';
import { requestApproval } from '@/stores/action-approval-store.ts';
import { useIssueStore } from '@/stores/issue-store.ts';
import { queryLogs } from '@/stores/log-store.ts';
import { buildNameResolver, humanizeD2DBlock } from '@/utils/program-humanizer.ts';
import { resolveSourceName } from '@/utils/source-attribution.ts';

/** Tool definition compatible with both Claude and OpenAI function calling */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Result of executing a tool call */
export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/** All available tool definitions for the AI */
export function getToolDefinitions(): ToolDef[] {
  return [
    {
      name: 'list_devices',
      description: 'List all devices in the system with their current status. Returns device names, addresses, types, and current values.',
      parameters: { type: 'object', properties: { filter: { type: 'string', description: 'Optional filter by device name (case-insensitive partial match)' } } },
    },
    {
      name: 'get_device_status',
      description: 'Get the current status and all properties of a specific device by name or address.',
      parameters: { type: 'object', properties: { device: { type: 'string', description: 'Device name or address' } }, required: ['device'] },
    },
    {
      name: 'turn_on',
      description: 'Turn on a device (light, switch, outlet). Optionally set brightness level for dimmers (0-100%).',
      parameters: { type: 'object', properties: { device: { type: 'string', description: 'Device name or address' }, level: { type: 'number', description: 'Brightness level 0-100% for dimmers (optional, default 100%)' } }, required: ['device'] },
    },
    {
      name: 'turn_off',
      description: 'Turn off a device (light, switch, outlet).',
      parameters: { type: 'object', properties: { device: { type: 'string', description: 'Device name or address' } }, required: ['device'] },
    },
    {
      name: 'lock_device',
      description: 'Lock a door lock.',
      parameters: { type: 'object', properties: { device: { type: 'string', description: 'Lock device name or address' } }, required: ['device'] },
    },
    {
      name: 'unlock_device',
      description: 'Unlock a door lock.',
      parameters: { type: 'object', properties: { device: { type: 'string', description: 'Lock device name or address' } }, required: ['device'] },
    },
    {
      name: 'run_program',
      description: 'Run a program\'s THEN or ELSE clause by name or ID.',
      parameters: { type: 'object', properties: { program: { type: 'string', description: 'Program name or hex ID' }, clause: { type: 'string', enum: ['then', 'else'], description: 'Which clause to run (default: then)' } }, required: ['program'] },
    },
    {
      name: 'stop_program',
      description: 'Stop a currently running program.',
      parameters: { type: 'object', properties: { program: { type: 'string', description: 'Program name or hex ID' } }, required: ['program'] },
    },
    {
      name: 'list_programs',
      description: 'List all programs with their enabled/running status.',
      parameters: { type: 'object', properties: { filter: { type: 'string', description: 'Optional filter by program name' } } },
    },
    {
      name: 'get_low_batteries',
      description: 'Get all devices with battery levels, sorted by lowest first.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'query_device',
      description: 'Force a status query on a device to refresh its current values.',
      parameters: { type: 'object', properties: { device: { type: 'string', description: 'Device name or address' } }, required: ['device'] },
    },
    {
      name: 'capture_knowledge',
      description:
        'Save valuable knowledge to the Knowledge Base for future reference. Use this when you learn something useful during a conversation — troubleshooting steps, device configuration tips, integration details, or external research results. The knowledge will be stored permanently and available to help with future questions.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short descriptive title for this knowledge entry' },
          content: { type: 'string', description: 'The knowledge content — configuration steps, troubleshooting resolution, device capabilities, etc.' },
          deviceType: { type: 'string', description: 'Optional device type or integration name to associate this with (e.g., "Yale Lock", "Insteon Dimmer")' },
          isTroubleshooting: { type: 'boolean', description: 'True if this is a troubleshooting issue/resolution, false for general knowledge' },
        },
        required: ['title', 'content'],
      },
    },
    {
      name: 'file_issue_report',
      description:
        'File a bug report or feature request for the Super eisy app. Use this when you identify an issue that requires a code change to the app itself (not a device configuration or user action), or when the user explicitly wants to report a problem. Include your specific technical diagnosis and proposed solution.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['bug', 'feature'], description: 'Type of report: bug or feature request' },
          title: { type: 'string', description: 'Short descriptive title for the issue' },
          description: { type: 'string', description: 'Detailed description of the issue or feature' },
          diagnosis: { type: 'string', description: 'Your technical analysis of the root cause' },
          proposedFix: { type: 'string', description: 'Specific technical solution you recommend (code changes, configuration, etc.)' },
          affectedDevices: { type: 'array', items: { type: 'string' }, description: 'Names or addresses of affected devices (if applicable)' },
        },
        required: ['type', 'title', 'description', 'diagnosis'],
      },
    },
    {
      name: 'get_program_logic',
      description:
        'Get the full logic of a program — its IF conditions, THEN actions, and ELSE actions in human-readable form. Also shows last run/finish times, enabled status, and whether the IF condition is currently true or false.',
      parameters: {
        type: 'object',
        properties: {
          program: { type: 'string', description: 'Program name or hex ID' },
        },
        required: ['program'],
      },
    },
    {
      name: 'get_recent_events',
      description:
        'Get recent events for a device from the event log. Each event includes the ATTRIBUTED SOURCE (program name, manual, scene, AI, etc.) — this is the DEFINITIVE, DETERMINISTIC answer to "what caused this?" Do NOT guess or speculate — use this tool first for any "why is X on/off?" question. Leads with the most recent event.',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'Device name or address to filter events for (optional)' },
          category: { type: 'string', enum: ['command', 'program', 'comms', 'portal', 'scene'], description: 'Filter by event category (optional)' },
          limit: { type: 'number', description: 'Maximum number of events to return (default: 10)' },
        },
      },
    },
    {
      name: 'find_programs_for_device',
      description:
        'List all programs that COULD control or be triggered by a device. This is ONLY for answering "what programs are associated with this device?" — NOT for determining what actually caused a specific state change. For causality questions, use get_recent_events instead which returns the authoritative attributed source.',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'Device name or address' },
        },
        required: ['device'],
      },
    },
  ];
}

/** Resolve a device name to its address */
function resolveDevice(nameOrAddr: string): { address: string; name: string } | null {
  const store = useDeviceStore.getState();
  // Try exact address match
  const byAddr = store.getNode(nameOrAddr);
  if (byAddr) return { address: String(byAddr.address), name: byAddr.name };

  // Try name match (case-insensitive)
  const lower = nameOrAddr.toLowerCase();
  for (const node of store.nodes) {
    if (node.name.toLowerCase() === lower) return { address: String(node.address), name: node.name };
  }
  // Partial match
  for (const node of store.nodes) {
    if (node.name.toLowerCase().includes(lower)) return { address: String(node.address), name: node.name };
  }
  return null;
}

/** Resolve a program name to its hex ID */
function resolveProgram(nameOrId: string): { id: string; name: string } | null {
  const store = useProgramStore.getState();
  // Try ID match
  const byId = store.getProgram(nameOrId);
  if (byId) return { id: byId['@_id'], name: byId.name };

  // Try name match
  const lower = nameOrId.toLowerCase();
  for (const prog of store.programs) {
    if (prog.name.toLowerCase() === lower) return { id: prog['@_id'], name: prog.name };
  }
  for (const prog of store.programs) {
    if (prog.name.toLowerCase().includes(lower)) return { id: prog['@_id'], name: prog.name };
  }
  return null;
}

/** Check if a D2D XML block contains a device address (handles format variants) */
function containsAddress(d2dBlock: string, address: string): boolean {
  const block = d2dBlock.toLowerCase();
  const addr = address.toLowerCase();
  if (block.includes(addr)) return true;
  const addrSpaces = addr.replace(/\./g, ' ');
  if (addrSpaces !== addr && block.includes(addrSpaces)) return true;
  const addrDots = addr.replace(/ /g, '.');
  if (addrDots !== addr && block.includes(addrDots)) return true;
  return false;
}

/** Execute a tool call and return the result */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'list_devices': {
        const store = useDeviceStore.getState();
        const statusStore = useStatusStore.getState();
        let nodes = store.nodes;
        if (args.filter) {
          const f = String(args.filter).toLowerCase();
          nodes = nodes.filter((n) => n.name.toLowerCase().includes(f));
        }
        const list = nodes.slice(0, 50).map((n) => {
          const typeInfo = getDeviceTypeInfo(n['@_nodeDefId'], n.type ? String(n.type) : undefined);
          const st = statusStore.getProperty(n.address, 'ST');
          const status = st ? formatPropertyValue(st, typeInfo.category) : 'Unknown';
          return `${n.name} (${typeInfo.label}) — ${status}`;
        });
        return { success: true, message: `Found ${nodes.length} devices:\n${list.join('\n')}` };
      }

      case 'get_device_status': {
        const dev = resolveDevice(String(args.device));
        if (!dev) return { success: false, message: `Device "${args.device}" not found.` };
        const statusStore = useStatusStore.getState();
        const props = statusStore.getNodeProperties(dev.address);
        const node = useDeviceStore.getState().getNode(dev.address);
        const typeInfo = getDeviceTypeInfo(node?.['@_nodeDefId'], node?.type ? String(node.type) : undefined);
        const lines = [`Device: ${dev.name} (${typeInfo.label})`, `Address: ${dev.address}`];
        for (const [id, prop] of props) {
          lines.push(`${formatPropertyName(id)}: ${formatPropertyValue(prop, typeInfo.category)}`);
        }
        return { success: true, message: lines.join('\n') };
      }

      case 'turn_on': {
        const dev = resolveDevice(String(args.device));
        if (!dev) return { success: false, message: `Device "${args.device}" not found.` };
        const level = args.level != null ? Math.round(Number(args.level) * 255 / 100) : undefined;
        const pct = args.level != null ? `${args.level}%` : '100%';
        const approved = await requestApproval({
          description: `Turn on ${dev.name} to ${pct}`,
          detail: `sendNodeCommand('${dev.address}', 'DON'${level != null ? `, ${level}` : ''})`,
          source: 'ai-chat',
          deviceName: dev.name,
        });
        if (!approved) return { success: false, message: `Action denied by user: Turn on ${dev.name}` };
        const ok = await sendNodeCommand(dev.address, 'DON', level);
        return { success: ok, message: ok ? `Turned on ${dev.name}${args.level ? ` to ${args.level}%` : ''}.` : `Failed to turn on ${dev.name}.` };
      }

      case 'turn_off': {
        const dev = resolveDevice(String(args.device));
        if (!dev) return { success: false, message: `Device "${args.device}" not found.` };
        const approved = await requestApproval({
          description: `Turn off ${dev.name}`,
          detail: `sendNodeCommand('${dev.address}', 'DOF')`,
          source: 'ai-chat',
          deviceName: dev.name,
        });
        if (!approved) return { success: false, message: `Action denied by user: Turn off ${dev.name}` };
        const ok = await sendNodeCommand(dev.address, 'DOF');
        return { success: ok, message: ok ? `Turned off ${dev.name}.` : `Failed to turn off ${dev.name}.` };
      }

      case 'lock_device': {
        const dev = resolveDevice(String(args.device));
        if (!dev) return { success: false, message: `Device "${args.device}" not found.` };
        const approved = await requestApproval({
          description: `Lock ${dev.name}`,
          detail: `sendNodeCommand('${dev.address}', 'SECMD', 1)`,
          source: 'ai-chat',
          deviceName: dev.name,
        });
        if (!approved) return { success: false, message: `Action denied by user: Lock ${dev.name}` };
        const ok = await sendNodeCommand(dev.address, 'SECMD', 1);
        return { success: ok, message: ok ? `Locked ${dev.name}.` : `Failed to lock ${dev.name}.` };
      }

      case 'unlock_device': {
        const dev = resolveDevice(String(args.device));
        if (!dev) return { success: false, message: `Device "${args.device}" not found.` };
        const approved = await requestApproval({
          description: `Unlock ${dev.name}`,
          detail: `sendNodeCommand('${dev.address}', 'SECMD', 0)`,
          source: 'ai-chat',
          deviceName: dev.name,
        });
        if (!approved) return { success: false, message: `Action denied by user: Unlock ${dev.name}` };
        const ok = await sendNodeCommand(dev.address, 'SECMD', 0);
        return { success: ok, message: ok ? `Unlocked ${dev.name}.` : `Failed to unlock ${dev.name}.` };
      }

      case 'run_program': {
        const prog = resolveProgram(String(args.program));
        if (!prog) return { success: false, message: `Program "${args.program}" not found.` };
        const clause = String(args.clause ?? 'then');
        const approved = await requestApproval({
          description: `Run program "${prog.name}" (${clause})`,
          detail: `${clause === 'else' ? 'runProgramElse' : 'runProgram'}('${prog.id}')`,
          source: 'ai-chat',
        });
        if (!approved) return { success: false, message: `Action denied by user: Run program ${prog.name}` };
        const ok = clause === 'else' ? await runProgramElse(prog.id) : await runProgram(prog.id);
        return { success: ok, message: ok ? `Running ${prog.name} (${clause}).` : `Failed to run ${prog.name}.` };
      }

      case 'stop_program': {
        const prog = resolveProgram(String(args.program));
        if (!prog) return { success: false, message: `Program "${args.program}" not found.` };
        const approved = await requestApproval({
          description: `Stop program "${prog.name}"`,
          detail: `stopProgram('${prog.id}')`,
          source: 'ai-chat',
        });
        if (!approved) return { success: false, message: `Action denied by user: Stop program ${prog.name}` };
        const ok = await stopProgram(prog.id);
        return { success: ok, message: ok ? `Stopped ${prog.name}.` : `Failed to stop ${prog.name}.` };
      }

      case 'list_programs': {
        const store = useProgramStore.getState();
        let progs = store.programs.filter((p) => !boolAttr(p['@_folder']));
        if (args.filter) {
          const f = String(args.filter).toLowerCase();
          progs = progs.filter((p) => p.name.toLowerCase().includes(f));
        }
        const list = progs.slice(0, 50).map((p) => {
          const status = p['@_running'] === 'idle' ? (boolAttr(p['@_enabled']) ? 'Enabled' : 'Disabled') : `Running (${p['@_running']})`;
          return `${p.name} (ID ${p['@_id']}) — ${status}`;
        });
        return { success: true, message: `Found ${progs.length} programs:\n${list.join('\n')}` };
      }

      case 'get_low_batteries': {
        const store = useDeviceStore.getState();
        const statusStore = useStatusStore.getState();
        const batteries: { name: string; level: number }[] = [];
        for (const node of store.nodes) {
          const bat = statusStore.getProperty(node.address, 'BATLVL');
          if (bat) batteries.push({ name: node.name, level: Number(bat['@_value']) });
        }
        batteries.sort((a, b) => a.level - b.level);
        if (batteries.length === 0) return { success: true, message: 'No battery-powered devices found.' };
        const list = batteries.map((b) => `${b.name}: ${b.level}%${b.level <= 25 ? ' ⚠️ LOW' : ''}`);
        return { success: true, message: `Battery devices (${batteries.length}):\n${list.join('\n')}` };
      }

      case 'query_device': {
        const dev = resolveDevice(String(args.device));
        if (!dev) return { success: false, message: `Device "${args.device}" not found.` };
        const ok = await queryNode(dev.address);
        return { success: ok, message: ok ? `Querying ${dev.name}... status will update shortly.` : `Failed to query ${dev.name}.` };
      }

      case 'capture_knowledge': {
        const title = String(args.title ?? '');
        const content = String(args.content ?? '');
        if (!title || !content) return { success: false, message: 'Both title and content are required.' };
        await captureKnowledge({
          title,
          content,
          deviceType: args.deviceType ? String(args.deviceType) : undefined,
          isTroubleshooting: args.isTroubleshooting === true,
        });
        return { success: true, message: `Knowledge captured: "${title}"` };
      }

      case 'file_issue_report': {
        const issueTitle = String(args.title ?? '');
        const issueDesc = String(args.description ?? '');
        const issueType = args.type === 'feature' ? 'feature' as const : 'bug' as const;
        if (!issueTitle || !issueDesc) {
          return { success: false, message: 'Title and description are required for issue reports.' };
        }

        // Resolve affected device names
        const affectedDevices = Array.isArray(args.affectedDevices) ? args.affectedDevices.map(String) : [];
        const deviceNames: string[] = [];
        const deviceAddrs: string[] = [];
        for (const nameOrAddr of affectedDevices) {
          const dev = resolveDevice(nameOrAddr);
          if (dev) {
            deviceAddrs.push(dev.address);
            deviceNames.push(dev.name);
          } else {
            deviceNames.push(nameOrAddr);
          }
        }

        const issueStore = useIssueStore.getState();
        const systemInfo = issueStore.captureSystemInfo();

        const report = await issueStore.createReport({
          type: issueType,
          title: issueTitle,
          description: issueDesc,
          aiDiagnosis: args.diagnosis ? String(args.diagnosis) : undefined,
          proposedFix: args.proposedFix ? String(args.proposedFix) : undefined,
          devices: deviceAddrs.length > 0 ? deviceAddrs : undefined,
          deviceNames: deviceNames.length > 0 ? deviceNames : undefined,
          systemInfo,
        });

        return {
          success: true,
          message: `Issue report draft created: "${issueTitle}" (ID: ${report.id}). The user can review and submit it from the Troubleshooter page → Reports section.`,
        };
      }

      case 'get_program_logic': {
        const prog = resolveProgram(String(args.program));
        if (!prog) return { success: false, message: `Program "${args.program}" not found.` };

        const programStore = useProgramStore.getState();
        const programSummary = programStore.getProgram(prog.id);
        const decimalId = parseInt(prog.id, 16);
        const trigger = !isNaN(decimalId) ? programStore.getTrigger(decimalId) : undefined;

        const lines: string[] = [];
        lines.push(`Program: ${prog.name} (ID ${prog.id})`);

        if (programSummary) {
          lines.push(`Enabled: ${boolAttr(programSummary['@_enabled']) ? 'Yes' : 'No'}`);
          lines.push(`IF Condition: ${programSummary['@_status'] === 'true' ? 'TRUE (last ran THEN)' : programSummary['@_status'] === 'false' ? 'FALSE (last ran ELSE)' : 'Unknown'}`);
          if (programSummary.lastRunTime) lines.push(`Last Run: ${programSummary.lastRunTime}`);
          if (programSummary.lastFinishTime) lines.push(`Last Finish: ${programSummary.lastFinishTime}`);
          if (programSummary.nextScheduledRunTime) lines.push(`Next Scheduled: ${programSummary.nextScheduledRunTime}`);
        }

        if (trigger) {
          if (trigger.comment) lines.push(`Comment: ${trigger.comment}`);

          // Build name resolver for humanizing D2D blocks
          const deviceStore = useDeviceStore.getState();
          const resolver = buildNameResolver(
            deviceStore.nodeMap,
            deviceStore.sceneMap ?? new Map(),
            programStore.programs,
            programStore.triggers,
          );

          if (trigger.if) {
            const ifLines = humanizeD2DBlock(trigger.if, resolver);
            lines.push('\nIF:');
            for (const l of ifLines) lines.push(`${'  '.repeat(l.indent + 1)}${l.text}`);
          }
          if (trigger.then) {
            const thenLines = humanizeD2DBlock(trigger.then, resolver);
            lines.push('\nTHEN:');
            for (const l of thenLines) lines.push(`${'  '.repeat(l.indent + 1)}${l.text}`);
          }
          if (trigger.else) {
            const elseLines = humanizeD2DBlock(trigger.else, resolver);
            lines.push('\nELSE:');
            for (const l of elseLines) lines.push(`${'  '.repeat(l.indent + 1)}${l.text}`);
          }
        } else {
          lines.push('\n(D2D program details not available — program may not have conditions/actions)');
        }

        return { success: true, message: lines.join('\n') };
      }

      case 'get_recent_events': {
        // Resolve device name to address if provided
        let deviceAddr: string | undefined;
        let resolvedName: string | undefined;
        if (args.device) {
          const dev = resolveDevice(String(args.device));
          deviceAddr = dev?.address ?? String(args.device);
          resolvedName = dev?.name;
        }

        const limit = args.limit ? Math.min(Math.max(1, Number(args.limit) || 10), 50) : 10;
        const entries = await queryLogs({
          device: deviceAddr,
          category: args.category as 'command' | 'program' | 'comms' | 'portal' | 'scene' | undefined,
          limit,
          since: Date.now() - 24 * 60 * 60 * 1000, // Last 24 hours
        });

        if (entries.length === 0) {
          const target = resolvedName ? ` for "${resolvedName}"` : args.device ? ` for "${args.device}"` : '';
          return { success: true, message: `No recent events found${target} in the last 24 hours. This means either the device has not changed state recently, or the change happened before Super eisy started tracking events this session.` };
        }

        // Lead with the authoritative answer: the most recent event is THE cause.
        const mostRecent = entries[0]!;
        const mostRecentTime = new Date(mostRecent.timestamp).toLocaleString();
        const mostRecentSource = resolveSourceName(mostRecent.source);
        const deviceLabel = resolvedName ? `"${resolvedName}"` : (mostRecent.deviceName ?? 'Device');

        const lines: string[] = [];
        lines.push(`AUTHORITATIVE ANSWER: ${deviceLabel} was last affected at ${mostRecentTime} by ${mostRecentSource} (action: "${mostRecent.action}"). This is the actual recorded cause — not a guess.`);
        lines.push('');
        lines.push(`Recent events${args.device ? ` for ${deviceLabel}` : ''} (${entries.length}):`);

        for (const e of entries) {
          const time = new Date(e.timestamp).toLocaleTimeString();
          const device = e.deviceName ?? e.device ?? '';
          const source = resolveSourceName(e.source);
          lines.push(`${time} | ${device} | ${e.action} | ${source}${e.result === 'fail' ? ' [FAILED]' : ''}`);
        }

        return { success: true, message: lines.join('\n') };
      }

      case 'find_programs_for_device': {
        const dev = resolveDevice(String(args.device));
        if (!dev) return { success: false, message: `Device "${args.device}" not found.` };

        const addr = dev.address.toLowerCase();
        const triggers = useProgramStore.getState().triggers;
        const programs = useProgramStore.getState().programs;

        const results: { name: string; id: string; roles: string[] }[] = [];

        for (const trigger of triggers) {
          const roles: string[] = [];

          if (trigger.if && containsAddress(trigger.if, addr)) {
            roles.push('IF condition (triggers this program)');
          }
          if (trigger.then && containsAddress(trigger.then, addr)) {
            roles.push('THEN action (program controls this device)');
          }
          if (trigger.else && containsAddress(trigger.else, addr)) {
            roles.push('ELSE action (program controls this device)');
          }

          if (roles.length > 0) {
            const idStr = String(trigger.id);
            const progSummary = programs.find((p) => p['@_id'] === idStr);
            const enabled = progSummary ? boolAttr(progSummary['@_enabled']) : true;
            results.push({
              name: trigger.name || `Program ${idStr}`,
              id: idStr,
              roles: [...roles, enabled ? '(enabled)' : '(disabled)'],
            });
          }
        }

        if (results.length === 0) {
          return { success: true, message: `No programs reference "${dev.name}".` };
        }

        const lines = results.map((r) =>
          `${r.name} (ID ${r.id}): ${r.roles.join(', ')}`,
        );
        return { success: true, message: `Programs referencing "${dev.name}" (${results.length}):\n${lines.join('\n')}` };
      }

      default:
        return { success: false, message: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { success: false, message: `Error executing ${name}: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}
