/**
 * Visual block editor for creating/editing ISY programs.
 * Converts between a visual block representation and D2D XML format.
 */
import { useState, useCallback, useEffect } from 'react';
import {
  Code2,
  FileUp,
  FileDown,
  Save,
  Plus,
  MessageSquare,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { saveProgramFull } from '@/api/soap.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import {
  type ConditionBlock,
  type ActionBlock,
  type ConditionType,
  type ActionType,
  type LogicOp,
  type ScheduleCondition,
  type StatusCondition,
  type ControlCondition,
  ConditionBlockCard,
  ActionBlockCard,
  LogicPill,
  generateId,
} from '@/components/programs/ProgramBlocks.tsx';

// ─── Props ───────────────────────────────────────────────────

interface ProgramEditorProps {
  /** Program name to display in the header */
  programName?: string;
  /** Decimal program ID (used for SOAP save) */
  programId?: number;
  /** Pre-existing D2D trigger XML to edit (optional -- for editing existing programs) */
  initialXml?: string;
  /** Called when the user wants to save the generated XML */
  onSave?: (xml: string) => void;
}

// ─── Editor State ────────────────────────────────────────────

interface EditorState {
  conditions: ConditionBlock[];
  thenActions: ActionBlock[];
  elseActions: ActionBlock[];
  comment: string;
}

function emptyState(): EditorState {
  return {
    conditions: [],
    thenActions: [],
    elseActions: [],
    comment: '',
  };
}

// ─── Component ───────────────────────────────────────────────

export function ProgramEditor({ programName, programId, initialXml, onSave }: ProgramEditorProps) {
  const [state, setState] = useState<EditorState>(emptyState);
  const [generatedXml, setGeneratedXml] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Parse initialXml on mount
  useEffect(() => {
    if (initialXml) {
      try {
        const parsed = parseD2DXml(initialXml);
        setState(parsed);
        setParseError(null);
      } catch (err) {
        setParseError(`Failed to parse initial XML: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [initialXml]);

  // ─── Condition Handlers ──────────────────────────────────

  const addCondition = useCallback((type: ConditionType) => {
    let cond: ConditionBlock['condition'];
    if (type === 'schedule') {
      cond = { type: 'schedule', from: { sunset: 0 }, to: { sunrise: 0, nextDay: true } };
    } else if (type === 'status') {
      cond = { type: 'status', node: '', property: 'ST', operator: 'IS', value: '', uom: '51' };
    } else if (type === 'control') {
      cond = { type: 'control', node: '', event: 'DON' };
    } else {
      cond = { type: 'group', conditions: [] };
    }
    const block: ConditionBlock = { id: generateId(), logic: 'and', condition: cond };
    setState((prev) => ({ ...prev, conditions: [...prev.conditions, block] }));
  }, []);

  const updateCondition = useCallback((index: number, block: ConditionBlock) => {
    setState((prev) => {
      const next = [...prev.conditions];
      next[index] = block;
      return { ...prev, conditions: next };
    });
  }, []);

  const removeCondition = useCallback((index: number) => {
    setState((prev) => ({ ...prev, conditions: prev.conditions.filter((_, i) => i !== index) }));
  }, []);

  const moveCondition = useCallback((from: number, to: number) => {
    setState((prev) => {
      const next = [...prev.conditions];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return { ...prev, conditions: next };
    });
  }, []);

  // ─── Action Handlers (THEN) ──────────────────────────────

  const addThenAction = useCallback((type: ActionType) => {
    const block = createActionBlock(type);
    setState((prev) => ({ ...prev, thenActions: [...prev.thenActions, block] }));
  }, []);

  const updateThenAction = useCallback((index: number, block: ActionBlock) => {
    setState((prev) => {
      const next = [...prev.thenActions];
      next[index] = block;
      return { ...prev, thenActions: next };
    });
  }, []);

  const removeThenAction = useCallback((index: number) => {
    setState((prev) => ({ ...prev, thenActions: prev.thenActions.filter((_, i) => i !== index) }));
  }, []);

  const moveThenAction = useCallback((from: number, to: number) => {
    setState((prev) => {
      const next = [...prev.thenActions];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return { ...prev, thenActions: next };
    });
  }, []);

  // ─── Action Handlers (ELSE) ──────────────────────────────

  const addElseAction = useCallback((type: ActionType) => {
    const block = createActionBlock(type);
    setState((prev) => ({ ...prev, elseActions: [...prev.elseActions, block] }));
  }, []);

  const updateElseAction = useCallback((index: number, block: ActionBlock) => {
    setState((prev) => {
      const next = [...prev.elseActions];
      next[index] = block;
      return { ...prev, elseActions: next };
    });
  }, []);

  const removeElseAction = useCallback((index: number) => {
    setState((prev) => ({ ...prev, elseActions: prev.elseActions.filter((_, i) => i !== index) }));
  }, []);

  const moveElseAction = useCallback((from: number, to: number) => {
    setState((prev) => {
      const next = [...prev.elseActions];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return { ...prev, elseActions: next };
    });
  }, []);

  // ─── Generate XML ────────────────────────────────────────

  const handleGenerate = useCallback(() => {
    const xml = generateD2DXml(state);
    setGeneratedXml(xml);
    console.log('[ProgramEditor] Generated D2D XML:\n', xml);
  }, [state]);

  const handleSave = useCallback(async () => {
    if (!programId) {
      setSaveStatus({ ok: false, msg: 'No program ID — cannot save.' });
      return;
    }
    setSaving(true);
    setSaveStatus(null);
    try {
      const xml = generateD2DXml(state);
      setGeneratedXml(xml);
      const d2dKey = useProgramStore.getState().d2dKey;
      const result = await saveProgramFull(programId, xml, d2dKey);
      if (result.success) {
        setSaveStatus({ ok: true, msg: 'Program saved successfully.' });
        // Refresh program data so the detail view reflects changes
        useProgramStore.getState().fetchAll();
        onSave?.(xml);
      } else {
        setSaveStatus({ ok: false, msg: `Save failed (${result.status}): ${result.info ?? 'unknown error'}` });
      }
    } catch (err) {
      setSaveStatus({ ok: false, msg: `Save error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  }, [state, onSave, programId]);

  // ─── Import XML ──────────────────────────────────────────

  const handleImport = useCallback(() => {
    try {
      const parsed = parseD2DXml(importText);
      setState(parsed);
      setShowImport(false);
      setImportText('');
      setParseError(null);
      setGeneratedXml(null);
    } catch (err) {
      setParseError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [importText]);

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
          <Code2 size={24} className="text-indigo-600 dark:text-indigo-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {programName ? `Editing: ${programName}` : 'Program Editor'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {programId ? `Program #${programId.toString(16).toUpperCase().padStart(4, '0')}` : 'Visual block editor for ISY programs'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImport(!showImport)}
            className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <FileUp size={14} /> Import XML
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <FileDown size={14} /> Generate XML
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !programId}
            className="flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Save status feedback */}
      {saveStatus && (
        <div className={`flex items-center gap-2 rounded-lg border p-3 ${
          saveStatus.ok
            ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/10'
            : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10'
        }`}>
          {saveStatus.ok ? (
            <CheckCircle2 size={16} className="flex-shrink-0 text-green-500" />
          ) : (
            <XCircle size={16} className="flex-shrink-0 text-red-500" />
          )}
          <p className={`text-xs ${saveStatus.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
            {saveStatus.msg}
          </p>
        </div>
      )}

      {/* Parse error */}
      {parseError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/10">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-red-500" />
          <p className="text-xs text-red-700 dark:text-red-400">{parseError}</p>
        </div>
      )}

      {/* Import panel */}
      {showImport && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            Paste D2D XML (the &lt;trigger&gt; block)
          </label>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            className="w-full rounded border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
            placeholder="<trigger><if>...</if><then>...</then><else>...</else><comment>...</comment></trigger>"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleImport}
              disabled={!importText.trim()}
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => { setShowImport(false); setImportText(''); }}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ─── IF Section ─────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <div className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
            IF
          </div>
          <div className="h-px flex-1 bg-amber-200 dark:bg-amber-800" />
        </div>

        <div className="space-y-1">
          {state.conditions.map((block, idx) => (
            <div key={block.id}>
              <LogicPill
                value={block.logic}
                onChange={(val) => updateCondition(idx, { ...block, logic: val })}
                first={idx === 0}
              />
              <ConditionBlockCard
                block={block}
                index={idx}
                onUpdate={(updated) => updateCondition(idx, updated)}
                onRemove={() => removeCondition(idx)}
                onMoveUp={idx > 0 ? () => moveCondition(idx, idx - 1) : undefined}
                onMoveDown={idx < state.conditions.length - 1 ? () => moveCondition(idx, idx + 1) : undefined}
              />
            </div>
          ))}
        </div>

        <AddConditionButton onAdd={addCondition} />
      </section>

      {/* ─── THEN Section ───────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <div className="rounded bg-green-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-green-700 dark:bg-green-900/40 dark:text-green-400">
            THEN
          </div>
          <div className="h-px flex-1 bg-green-200 dark:bg-green-800" />
        </div>

        <div className="space-y-2">
          {state.thenActions.map((block, idx) => (
            <ActionBlockCard
              key={block.id}
              block={block}
              index={idx}
              color="green"
              onUpdate={(updated) => updateThenAction(idx, updated)}
              onRemove={() => removeThenAction(idx)}
              onMoveUp={idx > 0 ? () => moveThenAction(idx, idx - 1) : undefined}
              onMoveDown={idx < state.thenActions.length - 1 ? () => moveThenAction(idx, idx + 1) : undefined}
            />
          ))}
        </div>

        <AddActionButton onAdd={addThenAction} color="green" />
      </section>

      {/* ─── ELSE Section ───────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <div className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
            ELSE
          </div>
          <div className="h-px flex-1 bg-blue-200 dark:bg-blue-800" />
        </div>

        <div className="space-y-2">
          {state.elseActions.map((block, idx) => (
            <ActionBlockCard
              key={block.id}
              block={block}
              index={idx}
              color="blue"
              onUpdate={(updated) => updateElseAction(idx, updated)}
              onRemove={() => removeElseAction(idx)}
              onMoveUp={idx > 0 ? () => moveElseAction(idx, idx - 1) : undefined}
              onMoveDown={idx < state.elseActions.length - 1 ? () => moveElseAction(idx, idx + 1) : undefined}
            />
          ))}
        </div>

        <AddActionButton onAdd={addElseAction} color="blue" />
      </section>

      {/* ─── Comment ────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <div className="rounded bg-gray-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            <MessageSquare size={10} className="mr-1 inline" />
            Comment
          </div>
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        </div>
        <textarea
          value={state.comment}
          onChange={(e) => setState((prev) => ({ ...prev, comment: e.target.value }))}
          rows={2}
          placeholder="Program description or notes..."
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </section>

      {/* ─── Generated XML Output ───────────────────────── */}
      {generatedXml !== null && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <div className="rounded bg-gray-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              Generated XML
            </div>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          </div>
          <pre className="max-h-64 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
            {generatedXml}
          </pre>
        </section>
      )}
    </div>
  );
}

// ─── Add Buttons ─────────────────────────────────────────────

function AddConditionButton({ onAdd }: { onAdd: (type: ConditionType) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-amber-200 py-2 text-xs font-medium text-amber-600 hover:border-amber-300 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-500 dark:hover:border-amber-700 dark:hover:bg-amber-900/20"
      >
        <Plus size={14} /> Add Condition
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {([
            ['schedule', 'Schedule'],
            ['status', 'Status Check'],
            ['control', 'Control Event'],
            ['group', 'Condition Group'],
          ] as [ConditionType, string][]).map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => { onAdd(type); setOpen(false); }}
              className="flex w-full items-center px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddActionButton({ onAdd, color }: { onAdd: (type: ActionType) => void; color: 'green' | 'blue' }) {
  const [open, setOpen] = useState(false);

  const borderClass = color === 'green'
    ? 'border-green-200 text-green-600 hover:border-green-300 hover:bg-green-50 dark:border-green-800 dark:text-green-500 dark:hover:border-green-700 dark:hover:bg-green-900/20'
    : 'border-blue-200 text-blue-600 hover:border-blue-300 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-500 dark:hover:border-blue-700 dark:hover:bg-blue-900/20';

  return (
    <div className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed py-2 text-xs font-medium ${borderClass}`}
      >
        <Plus size={14} /> Add Action
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {([
            ['cmd', 'Device Command'],
            ['wait', 'Wait'],
            ['runthen', 'Run Program (Then)'],
            ['runelse', 'Run Program (Else)'],
            ['runif', 'Run Program (If)'],
            ['enable', 'Enable Program'],
            ['disable', 'Disable Program'],
            ['notify', 'Send Notification'],
          ] as [ActionType, string][]).map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => { onAdd(type); setOpen(false); }}
              className="flex w-full items-center px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Block Factory ───────────────────────────────────────────

function createActionBlock(type: ActionType): ActionBlock {
  const base: ActionBlock = { id: generateId(), action: type };

  switch (type) {
    case 'cmd':
      return { ...base, node: '', command: 'DON', value: '', uom: '51' };
    case 'wait':
      return { ...base, hours: 0, minutes: 0, seconds: 0 };
    case 'runthen':
    case 'runelse':
    case 'runif':
    case 'enable':
    case 'disable':
      return { ...base, programId: '' };
    case 'notify':
      return { ...base, notifyContent: '1', notifyChannel: '1' };
    default:
      return base;
  }
}

// ─── XML Generation ──────────────────────────────────────────

function generateD2DXml(state: EditorState): string {
  const parts: string[] = [];
  parts.push('<trigger>');

  // IF section
  parts.push('  <if>');
  for (const block of state.conditions) {
    parts.push(generateConditionXml(block, '    '));
  }
  parts.push('  </if>');

  // THEN section
  parts.push('  <then>');
  for (const block of state.thenActions) {
    parts.push(generateActionXml(block, '    '));
  }
  parts.push('  </then>');

  // ELSE section
  parts.push('  <else>');
  for (const block of state.elseActions) {
    parts.push(generateActionXml(block, '    '));
  }
  parts.push('  </else>');

  // Comment
  if (state.comment.trim()) {
    parts.push(`  <comment>${escapeXml(state.comment.trim())}</comment>`);
  }

  parts.push('</trigger>');
  return parts.join('\n');
}

function generateConditionXml(block: ConditionBlock, indent: string): string {
  const lines: string[] = [];
  const cond = block.condition;

  // Logic connector (and/or)
  lines.push(`${indent}<${block.logic} />`);

  if (cond.type === 'schedule') {
    lines.push(generateScheduleXml(cond, indent));
  } else if (cond.type === 'status') {
    lines.push(generateStatusXml(cond, indent));
  } else if (cond.type === 'control') {
    lines.push(generateControlXml(cond, indent));
  } else if (cond.type === 'group') {
    lines.push(`${indent}<paren>`);
    for (const child of cond.conditions) {
      lines.push(generateConditionXml(child, indent + '  '));
    }
    lines.push(`${indent}</paren>`);
  }

  return lines.join('\n');
}

function generateScheduleXml(cond: ScheduleCondition, indent: string): string {
  const parts: string[] = [];
  parts.push(`${indent}<schedule>`);

  if (cond.from) {
    parts.push(`${indent}  <from>${generateTimeRefXml(cond.from)}</from>`);
  }

  if (cond.to) {
    const timeXml = generateTimeRefXml(cond.to);
    const dayXml = cond.to.nextDay ? `<day>1</day>` : '';
    parts.push(`${indent}  <to>${timeXml}${dayXml}</to>`);
  }

  if (cond.daysOfWeek && cond.daysOfWeek.length > 0) {
    const dayTags = cond.daysOfWeek.map((d) => `<${d.toLowerCase()} />`).join('');
    parts.push(`${indent}  <daysofweek>${dayTags}</daysofweek>`);
  }

  parts.push(`${indent}</schedule>`);
  return parts.join('\n');
}

function generateTimeRefXml(ref: { sunset?: number; sunrise?: number; time?: number }): string {
  if (ref.sunset !== undefined) return `<sunset>${ref.sunset}</sunset>`;
  if (ref.sunrise !== undefined) return `<sunrise>${ref.sunrise}</sunrise>`;
  if (ref.time !== undefined) return `<time>${ref.time}</time>`;
  return '<sunset>0</sunset>';
}

function generateStatusXml(cond: StatusCondition, indent: string): string {
  const valXml = cond.value ? `<val uom="${escapeXml(cond.uom)}" prec="0">${escapeXml(cond.value)}</val>` : '';
  return `${indent}<status id="${escapeXml(cond.property)}" node="${escapeXml(cond.node)}" op="${escapeXml(cond.operator)}">${valXml}</status>`;
}

function generateControlXml(cond: ControlCondition, indent: string): string {
  return `${indent}<control id="${escapeXml(cond.event)}" node="${escapeXml(cond.node)}" op="IS"></control>`;
}

function generateActionXml(block: ActionBlock, indent: string): string {
  switch (block.action) {
    case 'cmd': {
      if (block.value) {
        return `${indent}<cmd id="${escapeXml(block.command ?? 'DON')}" node="${escapeXml(block.node ?? '')}"><p id=""><val uom="${escapeXml(block.uom ?? '51')}" prec="0">${escapeXml(block.value)}</val></p></cmd>`;
      }
      return `${indent}<cmd id="${escapeXml(block.command ?? 'DON')}" node="${escapeXml(block.node ?? '')}"></cmd>`;
    }
    case 'wait': {
      const parts: string[] = [];
      if (block.hours && block.hours > 0) parts.push(`<hours>${block.hours}</hours>`);
      if (block.minutes && block.minutes > 0) parts.push(`<minutes>${block.minutes}</minutes>`);
      if (block.seconds && block.seconds > 0) parts.push(`<seconds>${block.seconds}</seconds>`);
      if (parts.length === 0) parts.push('<seconds>0</seconds>');
      return `${indent}<wait>${parts.join('')}</wait>`;
    }
    case 'runthen':
      return `${indent}<runthen>${escapeXml(block.programId ?? '')}</runthen>`;
    case 'runelse':
      return `${indent}<runelse>${escapeXml(block.programId ?? '')}</runelse>`;
    case 'runif':
      return `${indent}<runif>${escapeXml(block.programId ?? '')}</runif>`;
    case 'enable':
      return `${indent}<enable>${escapeXml(block.programId ?? '')}</enable>`;
    case 'disable':
      return `${indent}<disable>${escapeXml(block.programId ?? '')}</disable>`;
    case 'notify':
      return `${indent}<notify content="${escapeXml(block.notifyContent ?? '1')}">${escapeXml(block.notifyChannel ?? '1')}</notify>`;
    default:
      return '';
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── XML Parsing (Import) ───────────────────────────────────

function parseD2DXml(xml: string): EditorState {
  // Clean up common wrapper variations
  let cleaned = xml.trim();

  // Decode HTML entities that may be in the raw D2D data
  cleaned = cleaned
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '');

  // Wrap in <trigger> if not already
  if (!cleaned.startsWith('<trigger>')) {
    cleaned = `<trigger>${cleaned}</trigger>`;
  }

  const state = emptyState();

  // Extract sections using regex (more reliable than fast-xml-parser for this mixed format)
  const ifMatch = cleaned.match(/<if>([\s\S]*?)<\/if>/);
  const thenMatch = cleaned.match(/<then>([\s\S]*?)<\/then>/);
  const elseMatch = cleaned.match(/<else>([\s\S]*?)<\/else>/);
  const commentMatch = cleaned.match(/<comment>([\s\S]*?)<\/comment>/);

  if (ifMatch?.[1]) {
    state.conditions = parseConditions(ifMatch[1]);
  }

  if (thenMatch?.[1]) {
    state.thenActions = parseActions(thenMatch[1]);
  }

  if (elseMatch?.[1]) {
    state.elseActions = parseActions(elseMatch[1]);
  }

  if (commentMatch?.[1]) {
    state.comment = commentMatch[1].trim();
  }

  return state;
}

function parseConditions(xml: string): ConditionBlock[] {
  const blocks: ConditionBlock[] = [];

  // Tokenize: walk through the XML content extracting logical connectors and condition elements
  let remaining = xml.trim();
  let currentLogic: LogicOp = 'and';

  while (remaining.length > 0) {
    remaining = remaining.replace(/^\s+/, '');
    if (!remaining) break;

    // Logic connectors
    const andMatch = remaining.match(/^<and\s*\/?>/);
    if (andMatch) {
      currentLogic = 'and';
      remaining = remaining.slice(andMatch[0].length);
      continue;
    }

    const orMatch = remaining.match(/^<or\s*\/?>/);
    if (orMatch) {
      currentLogic = 'or';
      remaining = remaining.slice(orMatch[0].length);
      continue;
    }

    // Schedule block
    const scheduleMatch = remaining.match(/^<schedule>([\s\S]*?)<\/schedule>/);
    if (scheduleMatch) {
      blocks.push({
        id: generateId(),
        logic: currentLogic,
        condition: parseScheduleCondition(scheduleMatch[1]!),
      });
      remaining = remaining.slice(scheduleMatch[0].length);
      continue;
    }

    // Status block
    const statusMatch = remaining.match(/^<status([^>]*)>([\s\S]*?)<\/status>/);
    if (statusMatch) {
      blocks.push({
        id: generateId(),
        logic: currentLogic,
        condition: parseStatusCondition(statusMatch[1]!, statusMatch[2]!),
      });
      remaining = remaining.slice(statusMatch[0].length);
      continue;
    }

    // Control block (non-self-closing)
    const controlMatch = remaining.match(/^<control([^>]*)>[^<]*<\/control>/);
    if (controlMatch) {
      blocks.push({
        id: generateId(),
        logic: currentLogic,
        condition: parseControlCondition(controlMatch[1]!),
      });
      remaining = remaining.slice(controlMatch[0].length);
      continue;
    }

    // Control block (self-closing)
    const controlSelfMatch = remaining.match(/^<control([^>]*)\/>/);
    if (controlSelfMatch) {
      blocks.push({
        id: generateId(),
        logic: currentLogic,
        condition: parseControlCondition(controlSelfMatch[1]!),
      });
      remaining = remaining.slice(controlSelfMatch[0].length);
      continue;
    }

    // Paren group
    const parenMatch = remaining.match(/^<paren>([\s\S]*?)<\/paren>/);
    if (parenMatch) {
      const innerConditions = parseConditions(parenMatch[1]!);
      blocks.push({
        id: generateId(),
        logic: currentLogic,
        condition: { type: 'group', conditions: innerConditions },
      });
      remaining = remaining.slice(parenMatch[0].length);
      continue;
    }

    // Skip unknown tags
    const unknownTag = remaining.match(/^<[^>]+>/);
    if (unknownTag) {
      remaining = remaining.slice(unknownTag[0].length);
      continue;
    }

    // Skip non-tag content
    const nonTag = remaining.match(/^[^<]+/);
    if (nonTag) {
      remaining = remaining.slice(nonTag[0].length);
      continue;
    }

    // Safety: skip one character to avoid infinite loop
    remaining = remaining.slice(1);
  }

  return blocks;
}

function parseScheduleCondition(inner: string): ScheduleCondition {
  const cond: ScheduleCondition = { type: 'schedule' };

  const fromMatch = inner.match(/<from>([\s\S]*?)<\/from>/);
  if (fromMatch) {
    cond.from = parseTimeRef(fromMatch[1]!);
  }

  const toMatch = inner.match(/<to>([\s\S]*?)<\/to>/);
  if (toMatch) {
    cond.to = parseTimeRef(toMatch[1]!);
    if (/<day>1<\/day>/.test(toMatch[1]!)) {
      cond.to.nextDay = true;
    }
  }

  const dowMatch = inner.match(/<daysofweek>([\s\S]*?)<\/daysofweek>/);
  if (dowMatch) {
    const days: string[] = [];
    if (/<mon\s*\/?>/.test(dowMatch[1]!)) days.push('Mon');
    if (/<tue\s*\/?>/.test(dowMatch[1]!)) days.push('Tue');
    if (/<wed\s*\/?>/.test(dowMatch[1]!)) days.push('Wed');
    if (/<thu\s*\/?>/.test(dowMatch[1]!)) days.push('Thu');
    if (/<fri\s*\/?>/.test(dowMatch[1]!)) days.push('Fri');
    if (/<sat\s*\/?>/.test(dowMatch[1]!)) days.push('Sat');
    if (/<sun\s*\/?>/.test(dowMatch[1]!)) days.push('Sun');
    cond.daysOfWeek = days;
  }

  return cond;
}

function parseTimeRef(inner: string): { sunset?: number; sunrise?: number; time?: number } {
  const sunsetMatch = inner.match(/<sunset>(-?\d+)<\/sunset>/);
  if (sunsetMatch) return { sunset: parseInt(sunsetMatch[1]!, 10) };

  const sunriseMatch = inner.match(/<sunrise>(-?\d+)<\/sunrise>/);
  if (sunriseMatch) return { sunrise: parseInt(sunriseMatch[1]!, 10) };

  const timeMatch = inner.match(/<time>(\d+)<\/time>/);
  if (timeMatch) return { time: parseInt(timeMatch[1]!, 10) };

  return { sunset: 0 };
}

function parseStatusCondition(attrStr: string, inner: string): StatusCondition {
  const attrs = extractAttrs(attrStr);
  const valMatch = inner.match(/<val[^>]*>([^<]*)<\/val>/);
  const uomMatch = inner.match(/uom="(\d+)"/);

  return {
    type: 'status',
    node: attrs.node ?? '',
    property: attrs.id ?? 'ST',
    operator: attrs.op ?? 'IS',
    value: valMatch?.[1] ?? '',
    uom: uomMatch?.[1] ?? '51',
  };
}

function parseControlCondition(attrStr: string): ControlCondition {
  const attrs = extractAttrs(attrStr);
  return {
    type: 'control',
    node: attrs.node ?? '',
    event: attrs.id ?? 'DON',
  };
}

function parseActions(xml: string): ActionBlock[] {
  const blocks: ActionBlock[] = [];
  let remaining = xml.trim();

  while (remaining.length > 0) {
    remaining = remaining.replace(/^\s+/, '');
    if (!remaining) break;

    // Cmd with children
    const cmdMatch = remaining.match(/^<cmd([^/]*?)>([\s\S]*?)<\/cmd>/);
    if (cmdMatch) {
      const attrs = extractAttrs(cmdMatch[1]!);
      const inner = cmdMatch[2]!;
      const valMatch = inner.match(/<val[^>]*>([^<]*)<\/val>/);
      const uomMatch = inner.match(/uom="(\d+)"/);

      blocks.push({
        id: generateId(),
        action: 'cmd',
        node: attrs.node ?? '',
        command: attrs.id ?? 'DON',
        value: valMatch?.[1] ?? '',
        uom: uomMatch?.[1] ?? '51',
      });
      remaining = remaining.slice(cmdMatch[0].length);
      continue;
    }

    // Self-closing cmd
    const cmdSelfMatch = remaining.match(/^<cmd([^>]*)\/>/);
    if (cmdSelfMatch) {
      const attrs = extractAttrs(cmdSelfMatch[1]!);
      blocks.push({
        id: generateId(),
        action: 'cmd',
        node: attrs.node ?? '',
        command: attrs.id ?? 'DON',
        value: '',
        uom: '51',
      });
      remaining = remaining.slice(cmdSelfMatch[0].length);
      continue;
    }

    // Wait
    const waitMatch = remaining.match(/^<wait>([\s\S]*?)<\/wait>/);
    if (waitMatch) {
      const inner = waitMatch[1]!;
      const hoursMatch = inner.match(/<hours>(\d+)<\/hours>/);
      const minutesMatch = inner.match(/<minutes>(\d+)<\/minutes>/);
      const secondsMatch = inner.match(/<seconds>(\d+)<\/seconds>/);
      blocks.push({
        id: generateId(),
        action: 'wait',
        hours: hoursMatch ? parseInt(hoursMatch[1]!, 10) : 0,
        minutes: minutesMatch ? parseInt(minutesMatch[1]!, 10) : 0,
        seconds: secondsMatch ? parseInt(secondsMatch[1]!, 10) : 0,
      });
      remaining = remaining.slice(waitMatch[0].length);
      continue;
    }

    // Program refs
    const progTags: ActionType[] = ['runthen', 'runelse', 'runif', 'enable', 'disable'];
    let progMatched = false;
    for (const tag of progTags) {
      const re = new RegExp(`^<${tag}>([\\s\\S]*?)</${tag}>`);
      const m = remaining.match(re);
      if (m) {
        blocks.push({
          id: generateId(),
          action: tag,
          programId: m[1]!.trim(),
        });
        remaining = remaining.slice(m[0].length);
        progMatched = true;
        break;
      }
    }
    if (progMatched) continue;

    // Notify
    const notifyMatch = remaining.match(/^<notify\s*([^>]*)>([^<]*)<\/notify>/);
    if (notifyMatch) {
      const contentMatch = notifyMatch[1]!.match(/content="([^"]*)"/);
      blocks.push({
        id: generateId(),
        action: 'notify',
        notifyContent: contentMatch?.[1] ?? '1',
        notifyChannel: notifyMatch[2]!.trim() || '1',
      });
      remaining = remaining.slice(notifyMatch[0].length);
      continue;
    }

    // Skip unknown tags
    const unknownTag = remaining.match(/^<[^>]+>/);
    if (unknownTag) {
      remaining = remaining.slice(unknownTag[0].length);
      continue;
    }

    // Skip non-tag content
    const nonTag = remaining.match(/^[^<]+/);
    if (nonTag) {
      remaining = remaining.slice(nonTag[0].length);
      continue;
    }

    remaining = remaining.slice(1);
  }

  return blocks;
}

/** Extract attributes from an XML tag string */
function extractAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    if (m[1] !== undefined) attrs[m[1]] = m[2] ?? '';
  }
  return attrs;
}
