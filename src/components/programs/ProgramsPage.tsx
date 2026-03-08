/**
 * Programs page — split layout with program tree on left, detail/editor on right.
 * Toggle between tree view and UDAC-style summary table. Supports program creation.
 */
import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Code2, List, Plus, TableProperties } from 'lucide-react';
import { ProgramList } from './ProgramList.tsx';
import { ProgramDetail } from './ProgramDetail.tsx';
import { ProgramEditor } from './ProgramEditor.tsx';
import { ProgramSummary } from './ProgramSummary.tsx';
import { CreateProgramModal } from './CreateProgramModal.tsx';
import { useProgramStore } from '@/stores/program-store.ts';
import { moveProgramToFolder } from '@/api/rest.ts';

type ViewMode = 'tree' | 'summary';

export function ProgramsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const triggers = useProgramStore((s) => s.triggers);
  const programs = useProgramStore((s) => s.programs);
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle ?select=PROGRAM_ID from search palette
  useEffect(() => {
    const selectId = searchParams.get('select');
    if (selectId) {
      setSelectedId(selectId);
      setEditing(false);
      setViewMode('tree');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setEditing(false);
    setViewMode('tree');
  }, []);

  const handleProgramCreated = useCallback((hexId: string) => {
    setSelectedId(hexId);
    setEditing(true); // Open directly in editor
    setViewMode('tree');
    setShowCreateModal(false);
  }, []);

  const fetchAll = useProgramStore((s) => s.fetchAll);

  const handleMoveToFolder = useCallback(
    async (programId: string, _programName: string, folderId: string) => {
      try {
        const ok = await moveProgramToFolder(programId, folderId);
        if (ok) {
          await fetchAll();
        } else {
          console.error('[DnD] Failed to move program', programId, 'to folder', folderId);
        }
      } catch (err) {
        console.error('[DnD] MoveProgramToFolder error:', err);
      }
    },
    [fetchAll],
  );

  // Convert hex ID to decimal for D2D lookup
  const decimalId = selectedId ? parseInt(selectedId, 16) : null;

  // Get the D2D XML for the selected program (to pass to editor)
  const selectedTrigger = decimalId
    ? triggers.find((t) => t.id === decimalId)
    : null;

  // Get the program summary for the name
  const selectedProgram = selectedId
    ? programs.find((p) => p['@_id'] === selectedId)
    : null;

  // Combine IF/THEN/ELSE into a rough XML string for the editor
  const initialXml = selectedTrigger
    ? `<if>${selectedTrigger.if ?? ''}</if><then>${selectedTrigger.then ?? ''}</then><else>${selectedTrigger.else ?? ''}</else>`
    : undefined;

  // Summary view — full-width table
  if (viewMode === 'summary') {
    return (
      <div className="-m-4 flex h-[calc(100%+2rem)] flex-col">
        {/* View toggle bar */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
          <button
            onClick={() => setViewMode('tree')}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <List size={14} /> Tree View
          </button>
          <button
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-xs text-white"
          >
            <TableProperties size={14} /> Summary
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
          >
            <Plus size={14} />
            Create
          </button>
        </div>
        <div className="min-h-0 flex-1 p-4">
          <ProgramSummary onSelectProgram={handleSelect} />
        </div>

        <CreateProgramModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleProgramCreated}
        />
      </div>
    );
  }

  // Tree view — split layout
  return (
    <div className="-m-4 flex h-[calc(100%+2rem)]">
      {/* Program tree */}
      <div className="flex w-72 flex-shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        {/* View toggle + Create button */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <button
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-xs text-white"
          >
            <List size={14} /> Tree
          </button>
          <button
            onClick={() => setViewMode('summary')}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <TableProperties size={14} /> Summary
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
            title="Create Program"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ProgramList selectedId={selectedId} onSelect={handleSelect} onMoveToFolder={handleMoveToFolder} />
        </div>
      </div>

      {/* Detail or Editor panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedId ? (
          editing ? (
            <div className="space-y-3">
              <button
                onClick={() => setEditing(false)}
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                &larr; Back to detail
              </button>
              <ProgramEditor
                programName={selectedProgram?.name ?? selectedTrigger?.name}
                programId={decimalId ?? undefined}
                initialXml={initialXml}
                onSave={() => setEditing(false)}
              />
            </div>
          ) : (
            <ProgramDetail id={selectedId} onEdit={() => setEditing(true)} />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-gray-400 dark:text-gray-500">
            <Code2 size={48} className="mb-3 opacity-40" />
            <p className="text-sm">Select a program to view details</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <Plus size={14} />
              Create Program
            </button>
          </div>
        )}
      </div>

      <CreateProgramModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleProgramCreated}
      />
    </div>
  );
}
