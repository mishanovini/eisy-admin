/**
 * Global search palette (Cmd+K / Ctrl+K).
 * Searches across devices, scenes, and programs by name.
 *
 * Design: Expands across the top of the content area (no full-screen overlay,
 * no backdrop blur) so the user can still reference page content below.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Layers } from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import { useUIStore } from '@/stores/ui-store.ts';
import { boolAttr } from '@/utils/xml-parser.ts';
import { getDeviceTypeInfo } from '@/utils/device-types.ts';
import { ICON_MAP } from '@/components/tree/icon-map.ts';

interface SearchResult {
  type: 'device' | 'scene' | 'program';
  address: string;
  name: string;
  detail: string;
  icon: string;
}

export function SearchPalette() {
  const open = useUIStore((s) => s.searchOpen);
  const toggleSearch = useUIStore((s) => s.toggleSearch);
  const query = useUIStore((s) => s.searchQuery);
  const setQuery = useUIStore((s) => s.setSearchQuery);
  const nodes = useDeviceStore((s) => s.nodes);
  const scenes = useDeviceStore((s) => s.scenes);
  const programs = useProgramStore((s) => s.programs);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Keyboard shortcut to open/close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleSearch();
      }
      if (e.key === 'Escape' && open) {
        toggleSearch();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, toggleSearch]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    }
  }, [open]);

  // Close when clicking outside the palette (but no opaque backdrop)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        toggleSearch();
      }
    };
    // Delay listener so the opening click doesn't immediately close
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 10);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handler);
    };
  }, [open, toggleSearch]);

  // Build search results
  const results = useMemo((): SearchResult[] => {
    if (!query.trim()) return [];
    const lower = query.toLowerCase();
    const items: SearchResult[] = [];

    // Search devices
    for (const node of nodes) {
      if (node.name.toLowerCase().includes(lower)) {
        const typeInfo = getDeviceTypeInfo(node['@_nodeDefId'], node.type ? String(node.type) : undefined);
        items.push({
          type: 'device',
          address: String(node.address),
          name: node.name,
          detail: typeInfo.label,
          icon: typeInfo.icon,
        });
      }
    }

    // Search scenes
    for (const scene of scenes) {
      if (scene.name.toLowerCase().includes(lower)) {
        items.push({
          type: 'scene',
          address: String(scene.address),
          name: scene.name,
          detail: 'Scene',
          icon: 'Layers',
        });
      }
    }

    // Search programs
    for (const prog of programs) {
      if (prog.name.toLowerCase().includes(lower)) {
        items.push({
          type: 'program',
          address: prog['@_id'],
          name: prog.name,
          detail: boolAttr(prog['@_folder']) ? 'Program Folder' : 'Program',
          icon: 'Code2',
        });
      }
    }

    return items.slice(0, 20); // limit results
  }, [query, nodes, scenes, programs]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  const handleSelect = (result: SearchResult) => {
    toggleSearch();
    // Pass the address as a query param so the target page can pre-select the item
    const selectParam = encodeURIComponent(String(result.address));
    if (result.type === 'device') {
      navigate(`/devices?select=${selectParam}`);
    } else if (result.type === 'scene') {
      navigate(`/scenes?select=${selectParam}`);
    } else if (result.type === 'program') {
      navigate(`/programs?select=${selectParam}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex]!);
    }
  };

  if (!open) return null;

  return (
    <div
      ref={paletteRef}
      className="absolute inset-x-0 top-0 z-50"
    >
      {/* Search bar — spans the full width across the top, replacing the TopBar visually */}
      <div className="border-b border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-900">
        <div className="flex items-center gap-3 px-4">
          <Search size={18} className="flex-shrink-0 text-blue-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search devices, scenes, programs..."
            className="flex-1 bg-transparent py-3.5 text-sm text-gray-900 placeholder-gray-400 outline-none dark:text-gray-100 dark:placeholder-gray-500"
          />
          <kbd className="hidden rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400 sm:inline dark:bg-gray-800">
            Esc
          </kbd>
          <button
            onClick={toggleSearch}
            className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results dropdown */}
        {results.length > 0 && (
          <div className="max-h-80 overflow-y-auto border-t border-gray-200 py-1 dark:border-gray-700">
            {results.map((result, idx) => {
              const IconComponent = ICON_MAP[result.icon];
              return (
                <button
                  key={`${result.type}-${result.address}`}
                  onClick={() => handleSelect(result)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                    idx === selectedIndex
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className="flex-shrink-0">
                    {result.type === 'scene' ? (
                      <Layers size={16} className="text-purple-500" />
                    ) : IconComponent ? (
                      <IconComponent size={16} className="text-gray-400" />
                    ) : (
                      <span className="inline-block h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{result.name}</span>
                  <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {result.detail}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {query.trim() && results.length === 0 && (
          <div className="border-t border-gray-200 px-4 py-6 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
            No results for "{query}"
          </div>
        )}
      </div>
    </div>
  );
}
