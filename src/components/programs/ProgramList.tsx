/**
 * Hierarchical program list — folders and programs with status indicators.
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Play,
  CheckCircle2,
  XCircle,
  Search,
  RefreshCw,
} from 'lucide-react';
import { useProgramStore } from '@/stores/program-store.ts';
import { boolAttr } from '@/utils/xml-parser.ts';
import type { IsyProgram } from '@/api/types.ts';

interface ProgramListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface ProgramTreeItem {
  program: IsyProgram;
  children: ProgramTreeItem[];
}

export function ProgramList({ selectedId, onSelect }: ProgramListProps) {
  const programs = useProgramStore((s) => s.programs);
  const loading = useProgramStore((s) => s.loading);
  const fetchAll = useProgramStore((s) => s.fetchAll);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const hasAutoExpanded = useRef(false);
  const [filter, setFilter] = useState('');

  // Build tree structure from flat program list
  const tree = useMemo(() => buildProgramTree(programs), [programs]);

  // Auto-expand all folders when programs first load
  useEffect(() => {
    if (programs.length > 0 && !hasAutoExpanded.current) {
      hasAutoExpanded.current = true;
      const expanded = new Set<string>();
      for (const p of programs) {
        if (boolAttr(p['@_folder'])) expanded.add(p['@_id']);
      }
      setExpandedFolders(expanded);
    }
  }, [programs]);

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Filter programs by name
  const filteredTree = useMemo(() => {
    if (!filter.trim()) return tree;
    const lower = filter.toLowerCase();

    function matches(item: ProgramTreeItem): boolean {
      if (item.program.name.toLowerCase().includes(lower)) return true;
      return item.children.some(matches);
    }

    function filterItems(items: ProgramTreeItem[]): ProgramTreeItem[] {
      return items
        .filter(matches)
        .map((item) => ({ ...item, children: filterItems(item.children) }));
    }

    return filterItems(tree);
  }, [tree, filter]);

  const allIds = useMemo(() => {
    const ids: string[] = [];
    function walk(items: ProgramTreeItem[]) {
      for (const item of items) {
        ids.push(item.program['@_id']);
        walk(item.children);
      }
    }
    walk(filteredTree);
    return new Set(ids);
  }, [filteredTree]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter programs..."
            className="w-full rounded border border-gray-300 bg-transparent py-1 pl-7 pr-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
          />
        </div>
        <button
          onClick={() => fetchAll()}
          disabled={loading}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          title="Refresh programs"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredTree.length === 0 && !loading && (
          <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            {filter ? 'No programs match your filter.' : 'No programs found.'}
          </p>
        )}
        {filteredTree.map((item) => (
          <ProgramTreeNode
            key={item.program['@_id']}
            item={item}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            expandedFolders={filter ? allIds : expandedFolders}
            onToggleFolder={toggleFolder}
          />
        ))}
      </div>
    </div>
  );
}

function ProgramTreeNode({
  item,
  depth,
  selectedId,
  onSelect,
  expandedFolders,
  onToggleFolder,
}: {
  item: ProgramTreeItem;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (id: string) => void;
}) {
  const prog = item.program;
  const isFolder = boolAttr(prog['@_folder']);
  const isExpanded = expandedFolders.has(prog['@_id']);
  const isSelected = selectedId === prog['@_id'];
  const hasChildren = item.children.length > 0;

  return (
    <div>
      <button
        onClick={() => {
          if (isFolder && hasChildren) onToggleFolder(prog['@_id']);
          onSelect(prog['@_id']);
        }}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors ${
          isSelected
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        title={prog.name}
      >
        {/* Expand arrow */}
        <span className="flex w-4 flex-shrink-0 items-center justify-center">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown size={14} className="text-gray-400" />
            ) : (
              <ChevronRight size={14} className="text-gray-400" />
            )
          ) : null}
        </span>

        {/* Icon */}
        <span className="flex-shrink-0">
          {isFolder ? (
            isExpanded ? (
              <FolderOpen size={16} className="text-amber-500" />
            ) : (
              <Folder size={16} className="text-amber-500" />
            )
          ) : (
            <ProgramStatusIcon program={prog} />
          )}
        </span>

        {/* Name */}
        <span className="min-w-0 flex-1 truncate">{prog.name}</span>

        {/* Status badge for programs (not folders) */}
        {!isFolder && (
          <ProgramStatusBadge program={prog} />
        )}
      </button>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div>
          {item.children.map((child) => (
            <ProgramTreeNode
              key={child.program['@_id']}
              item={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProgramStatusIcon({ program }: { program: IsyProgram }) {
  const enabled = boolAttr(program['@_enabled']);
  const running = program['@_running'] === 'running' || program['@_running'] === 'then' || program['@_running'] === 'else';

  if (running) return <Play size={16} className="text-green-500" />;
  if (!enabled) return <XCircle size={16} className="text-gray-400" />;
  return <CheckCircle2 size={16} className="text-blue-500" />;
}

function ProgramStatusBadge({ program }: { program: IsyProgram }) {
  const enabled = boolAttr(program['@_enabled']);
  const running = program['@_running'];

  if (running === 'running' || running === 'then' || running === 'else') {
    return (
      <span className="flex-shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
        Running
      </span>
    );
  }

  if (!enabled) {
    return (
      <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">
        Disabled
      </span>
    );
  }

  return null;
}

/** Build a hierarchical tree from the flat program list using parentId */
function buildProgramTree(programs: IsyProgram[]): ProgramTreeItem[] {
  const items: ProgramTreeItem[] = programs.map((p) => ({ program: p, children: [] }));
  const byId = new Map<string, ProgramTreeItem>();
  for (const item of items) byId.set(item.program['@_id'], item);

  const roots: ProgramTreeItem[] = [];
  for (const item of items) {
    const parentId = item.program['@_parentId'];
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(item);
    } else {
      roots.push(item);
    }
  }

  // Sort: folders first, then alphabetical
  const sortItems = (arr: ProgramTreeItem[]) => {
    arr.sort((a, b) => {
      const aFolder = boolAttr(a.program['@_folder']);
      const bFolder = boolAttr(b.program['@_folder']);
      if (aFolder && !bFolder) return -1;
      if (!aFolder && bFolder) return 1;
      return a.program.name.localeCompare(b.program.name);
    });
    for (const item of arr) sortItems(item.children);
  };
  sortItems(roots);

  return roots;
}
