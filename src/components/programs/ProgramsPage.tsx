/**
 * Programs page — split layout with program tree on left, detail/editor on right.
 */
import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Code2 } from 'lucide-react';
import { ProgramList } from './ProgramList.tsx';
import { ProgramDetail } from './ProgramDetail.tsx';
import { ProgramEditor } from './ProgramEditor.tsx';
import { useProgramStore } from '@/stores/program-store.ts';

export function ProgramsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const triggers = useProgramStore((s) => s.triggers);
  const programs = useProgramStore((s) => s.programs);
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle ?select=PROGRAM_ID from search palette
  useEffect(() => {
    const selectId = searchParams.get('select');
    if (selectId) {
      setSelectedId(selectId);
      setEditing(false);
      // Clear the param so refresh doesn't re-select
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setEditing(false);
  }, []);

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

  return (
    <div className="-m-4 flex h-[calc(100%+2rem)]">
      {/* Program tree */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <ProgramList selectedId={selectedId} onSelect={handleSelect} />
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
          </div>
        )}
      </div>
    </div>
  );
}
