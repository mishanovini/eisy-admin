/**
 * Program detail panel — shows program info, IF/THEN/ELSE definitions,
 * and run/stop/enable/disable controls.
 */
import { useState } from 'react';
import {
  Play,
  Square,
  ToggleLeft,
  ToggleRight,
  Clock,
  Code2,
  RefreshCw,
  Pencil,
} from 'lucide-react';
import { useProgramStore } from '@/stores/program-store.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { boolAttr } from '@/utils/xml-parser.ts';
import {
  runProgram,
  runProgramElse,
  stopProgram,
  enableProgram,
  disableProgram,
} from '@/api/rest.ts';
import { useLogStore } from '@/stores/log-store.ts';
import { ConfirmDialog } from '@/components/common/ConfirmDialog.tsx';
import { useConfirm } from '@/hooks/useConfirm.ts';
import {
  buildNameResolver,
  humanizeD2DBlock,
  type NameResolver,
} from '@/utils/program-humanizer.ts';

interface ProgramDetailProps {
  id: string;
  onEdit?: () => void;
}

export function ProgramDetail({ id, onEdit }: ProgramDetailProps) {
  const program = useProgramStore((s) => s.getProgram(id));
  const trigger = useProgramStore((s) => s.getTrigger(parseInt(id, 16)));
  const nodeMap = useDeviceStore((s) => s.nodeMap);
  const sceneMap = useDeviceStore((s) => s.sceneMap);
  const programs = useProgramStore((s) => s.programs);
  const triggers = useProgramStore((s) => s.triggers);
  const [pending, setPending] = useState(false);
  const [confirmProps, confirm] = useConfirm();

  if (!program) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400 dark:text-gray-500">Program not found.</p>
      </div>
    );
  }

  const isFolder = boolAttr(program['@_folder']);
  const enabled = boolAttr(program['@_enabled']);
  const running = program['@_running'] === 'running' || program['@_running'] === 'then' || program['@_running'] === 'else';

  if (isFolder) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-900/20">
            <Code2 size={24} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {program.name}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Program Folder</p>
          </div>
        </div>
      </div>
    );
  }

  const exec = async (action: () => Promise<boolean>, actionLabel: string) => {
    setPending(true);
    try {
      const ok = await action();
      // Log program action to the event log
      useLogStore.getState().addEntry({
        category: 'program',
        device: id,
        deviceName: program.name,
        action: actionLabel,
        source: 'manual',
        result: ok ? 'success' : 'fail',
      });
      // Refresh program store after action
      setTimeout(() => useProgramStore.getState().fetchPrograms(), 500);
    } finally {
      setPending(false);
    }
  };

  // Build a name resolver that covers nodes, scenes, and programs
  const resolver = buildNameResolver(nodeMap, sceneMap, programs, triggers);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-900/20">
          <Code2 size={24} className="text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {program.name}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Program &middot; ID {program['@_id']}
            {running && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                <Play size={10} /> Running
              </span>
            )}
            {!enabled && (
              <span className="ml-2 text-xs text-gray-400">Disabled</span>
            )}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => exec(() => runProgram(id), 'Run Then')}
          disabled={pending}
          className="flex items-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          <Play size={14} /> Run Then
        </button>
        <button
          onClick={() => exec(() => runProgramElse(id), 'Run Else')}
          disabled={pending}
          className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Play size={14} /> Run Else
        </button>
        {running && (
          <button
            onClick={() => exec(() => stopProgram(id), 'Stop')}
            disabled={pending}
            className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Square size={14} /> Stop
          </button>
        )}
        <button
          onClick={async () => {
            if (enabled) {
              const ok = await confirm({
                title: 'Disable Program?',
                message: `"${program.name}" will stop running and won't trigger until re-enabled.`,
                confirmLabel: 'Disable',
                variant: 'warning',
              });
              if (!ok) return;
            }
            exec(enabled ? () => disableProgram(id) : () => enableProgram(id), enabled ? 'Disable' : 'Enable');
          }}
          disabled={pending}
          className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
          {enabled ? 'Disable' : 'Enable'}
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Pencil size={14} /> Edit
          </button>
        )}
      </div>

      {/* Run times */}
      <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          <Clock size={14} /> Timing
        </h3>
        <dl className="space-y-1 text-sm">
          <div className="flex">
            <dt className="w-32 text-gray-500 dark:text-gray-400">Last Run</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {program.lastRunTime?.trim() || 'Never'}
            </dd>
          </div>
          <div className="flex">
            <dt className="w-32 text-gray-500 dark:text-gray-400">Last Finished</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {program.lastFinishTime?.trim() || 'Never'}
            </dd>
          </div>
          {program.nextScheduledRunTime && (
            <div className="flex">
              <dt className="w-32 text-gray-500 dark:text-gray-400">Next Run</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {program.nextScheduledRunTime}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* IF / THEN / ELSE from D2D */}
      {trigger && (
        <div className="space-y-3">
          {trigger.if && (
            <ProgramBlock label="IF" content={trigger.if} resolver={resolver} color="amber" />
          )}
          {trigger.then && (
            <ProgramBlock label="THEN" content={trigger.then} resolver={resolver} color="green" />
          )}
          {trigger.else && (
            <ProgramBlock label="ELSE" content={trigger.else} resolver={resolver} color="blue" />
          )}
          {trigger.comment && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Comment: </span>
              <span className="text-sm text-gray-700 dark:text-gray-300">{trigger.comment}</span>
            </div>
          )}
        </div>
      )}

      {!trigger && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center dark:border-gray-700 dark:bg-gray-800/50">
          <p className="text-sm text-gray-400 dark:text-gray-500">
            D2D program logic not loaded. Click refresh to load full definitions.
          </p>
          <button
            onClick={() => useProgramStore.getState().fetchD2D()}
            className="mt-2 flex items-center gap-1 rounded bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            <RefreshCw size={12} /> Load D2D
          </button>
        </div>
      )}

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}

// ─── Program Block Rendering ─────────────────────────────────

function ProgramBlock({
  label,
  content,
  resolver,
  color,
}: {
  label: string;
  content: string;
  resolver: NameResolver;
  color: 'amber' | 'green' | 'blue';
}) {
  const colorClasses = {
    amber: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10',
    green: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/10',
    blue: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/10',
  };

  const labelClasses = {
    amber: 'text-amber-700 dark:text-amber-400',
    green: 'text-green-700 dark:text-green-400',
    blue: 'text-blue-700 dark:text-blue-400',
  };

  const humanReadable = humanizeD2DBlock(content, resolver);

  return (
    <div className={`rounded-lg border p-3 ${colorClasses[color]}`}>
      <div className={`mb-1 text-xs font-bold uppercase tracking-wider ${labelClasses[color]}`}>
        {label}
      </div>
      <div className="space-y-0.5 font-mono text-xs text-gray-800 dark:text-gray-200">
        {humanReadable.map((line, i) => (
          <div key={i} style={{ paddingLeft: `${line.indent * 16}px` }}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

