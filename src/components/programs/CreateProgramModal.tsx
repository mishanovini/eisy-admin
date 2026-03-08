/**
 * Modal for creating a new program.
 *
 * Simple flow: name + optional folder → creates an empty program
 * via the saveProgramFull SOAP sequence, then refreshes the store.
 * Programs are typically edited in the full ProgramEditor after creation.
 */
import { useState, useMemo } from 'react';
import {
  X,
  Code2,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { saveProgramFull, setParent } from '@/api/soap.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import { nextProgramId } from '@/utils/id-gen.ts';

interface CreateProgramModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after successful creation with the program hex ID */
  onCreated?: (hexId: string) => void;
}

/** Convert a decimal program ID to 4-digit uppercase hex */
function toHexId(id: number): string {
  return id.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Build a minimal empty D2D program XML.
 * This is the lightest valid program the eisy will accept.
 */
function buildEmptyProgramXml(): string {
  return `<trigger>
  <if></if>
  <then></then>
  <else></else>
</trigger>`;
}

export function CreateProgramModal({ open, onClose, onCreated }: CreateProgramModalProps) {
  const [programName, setProgramName] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string>('0'); // '0' = root
  const [openInEditor, setOpenInEditor] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const triggers = useProgramStore((s) => s.triggers);
  const d2dKey = useProgramStore((s) => s.d2dKey);
  const fetchAll = useProgramStore((s) => s.fetchAll);

  // Extract folders from triggers (they have a folder flag)
  const folders = useMemo(() => {
    return triggers
      .filter((t) => t.folder === 'true')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [triggers]);

  const handleCreate = async () => {
    if (!programName.trim()) return;
    setCreating(true);
    setError('');

    try {
      // Generate the next available program ID
      const newId = nextProgramId(triggers);
      const hexId = toHexId(newId);

      // Build empty program XML
      const xml = buildEmptyProgramXml();

      // Save via the full 6-step sequence
      const result = await saveProgramFull(newId, xml, d2dKey, {
        enabled: false, // Start disabled — user will enable after adding conditions/actions
        runAtStartup: false,
      });

      if (!result.success) {
        setError(result.info ?? 'Failed to create program.');
        setCreating(false);
        return;
      }

      // Move to folder if not root (parentType 3 = folder)
      if (selectedFolder !== '0') {
        await setParent(hexId, 1, selectedFolder, 3);
      }

      // Refresh program store
      await fetchAll();

      setSuccess(true);

      // Notify parent with the hex ID for selection
      if (openInEditor) {
        onCreated?.(hexId);
      }

      // Auto-close after brief delay
      setTimeout(() => {
        handleClose();
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create program.');
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setProgramName('');
    setSelectedFolder('0');
    setOpenInEditor(true);
    setCreating(false);
    setError('');
    setSuccess(false);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Modal */}
      <div className="relative mx-4 w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
              <Code2 size={16} className="text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Create New Program
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Program name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Program Name
            </label>
            <input
              type="text"
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && programName.trim() && !creating) handleCreate();
              }}
              placeholder="e.g. Sunset Lighting"
              autoFocus
              className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
            />
          </div>

          {/* Folder selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Folder
            </label>
            <select
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="0">Root (no folder)</option>
              {folders.map((f) => (
                <option key={f.id} value={String(f.id)}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {/* Open in editor checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={openInEditor}
              onChange={(e) => setOpenInEditor(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Open in editor after creation</span>
          </label>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Creates an empty program. Add conditions and actions using the program editor.
          </p>
        </div>

        {/* Error / success */}
        {error && (
          <div className="mx-5 mb-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 dark:border-red-800 dark:bg-red-900/20">
            <XCircle size={14} className="flex-shrink-0 text-red-600 dark:text-red-400" />
            <span className="text-xs text-red-700 dark:text-red-300">{error}</span>
          </div>
        )}

        {success && (
          <div className="mx-5 mb-2 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-2.5 dark:border-green-800 dark:bg-green-900/20">
            <CheckCircle2 size={14} className="flex-shrink-0 text-green-600 dark:text-green-400" />
            <span className="text-xs text-green-700 dark:text-green-300">Program created successfully!</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <button
            onClick={handleClose}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!programName.trim() || creating || success}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {creating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Creating...
              </>
            ) : (
              'Create Program'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
