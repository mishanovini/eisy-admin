/**
 * Backup & Restore — export/import system configuration as JSON.
 * Captures device names, program summaries, scenes, and variables.
 */
import { useState } from 'react';
import { Download, Clock, CheckCircle2 } from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import { useConnectionStore } from '@/stores/connection-store.ts';
import { fetchIntegerVariables, fetchStateVariables } from '@/api/rest.ts';

interface BackupData {
  version: 1;
  timestamp: string;
  host: string;
  config: unknown;
  devices: { address: string; name: string; nodeDefId?: string }[];
  scenes: { address: string; name: string; members: string[] }[];
  programs: { id: string; name: string; parentId: string; enabled: unknown; folder: unknown }[];
  variables?: { type: number; id: number; name?: string; val: number }[];
}

export function BackupRestore() {
  const [status, setStatus] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleExport = async () => {
    setStatus('exporting');
    try {
      const devices = useDeviceStore.getState();
      const programs = useProgramStore.getState();
      const connection = useConnectionStore.getState();

      // Fetch variables
      let intVars: { type: number; id: number; name?: string; val: number }[] = [];
      let stateVars: { type: number; id: number; name?: string; val: number }[] = [];
      try {
        const [iv, sv] = await Promise.all([fetchIntegerVariables(), fetchStateVariables()]);
        intVars = iv.map((v) => ({ type: 1, id: v['@_id'], name: v.name, val: v.val }));
        stateVars = sv.map((v) => ({ type: 2, id: v['@_id'], name: v.name, val: v.val }));
      } catch {
        // Variables might not be accessible
      }

      const backup: BackupData = {
        version: 1,
        timestamp: new Date().toISOString(),
        host: `${connection.host}:${connection.port}`,
        config: connection.config,
        devices: devices.nodes.map((n) => ({
          address: String(n.address),
          name: n.name,
          nodeDefId: n['@_nodeDefId'],
        })),
        scenes: devices.scenes.map((s) => ({
          address: String(s.address),
          name: s.name,
          members: Array.isArray(s.members?.link)
            ? s.members.link.map((l) => l['#text'])
            : s.members?.link ? [s.members.link['#text']] : [],
        })),
        programs: programs.programs.map((p) => ({
          id: p['@_id'],
          name: p.name,
          parentId: p['@_parentId'],
          enabled: p['@_enabled'],
          folder: p['@_folder'],
        })),
        variables: [...intVars, ...stateVars],
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eisy-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setStatus('done');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Export failed');
      setStatus('error');
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <Download size={16} className="text-blue-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Backup & Restore</h3>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Export a snapshot of your device names, scenes, programs, and variables as a JSON file.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={status === 'exporting'}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {status === 'exporting' ? (
              <Clock size={14} className="animate-spin" />
            ) : status === 'done' ? (
              <CheckCircle2 size={14} />
            ) : (
              <Download size={14} />
            )}
            {status === 'done' ? 'Exported!' : 'Export Backup'}
          </button>
        </div>
        {status === 'error' && (
          <p className="text-xs text-red-500">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
