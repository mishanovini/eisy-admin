/**
 * Scenes page — list of all scenes with detail panel and scene creation.
 */
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layers, Search, Plus } from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { SceneDetail } from './SceneDetail.tsx';
import { CreateSceneModal } from './CreateSceneModal.tsx';

export function ScenesPage() {
  const scenes = useDeviceStore((s) => s.scenes);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle ?select=ADDRESS from search palette
  useEffect(() => {
    const selectAddr = searchParams.get('select');
    if (selectAddr) {
      setSelectedAddress(String(selectAddr));
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Sort scenes alphabetically by name
  const sortedScenes = useMemo(
    () => [...scenes].sort((a, b) => a.name.localeCompare(b.name)),
    [scenes],
  );

  const filteredScenes = filter.trim()
    ? sortedScenes.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()))
    : sortedScenes;

  return (
    <div className="-m-4 flex h-[calc(100%+2rem)]">
      {/* Scene list */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="flex h-full flex-col">
          {/* Header with Create button */}
          <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Scenes</span>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-purple-600 transition-colors hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/20"
              title="Create Scene"
            >
              <Plus size={14} />
              Create
            </button>
          </div>

          {/* Filter */}
          <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter scenes..."
                className="w-full rounded border border-gray-300 bg-transparent py-1 pl-7 pr-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
              />
            </div>
          </div>

          {/* Scene list */}
          <div className="flex-1 overflow-y-auto py-1">
            {filteredScenes.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                {filter ? 'No scenes match your filter.' : 'No scenes found.'}
              </p>
            )}
            {filteredScenes.map((scene) => {
              const memberCount = Array.isArray(scene.members?.link)
                ? scene.members.link.length
                : scene.members?.link
                  ? 1
                  : 0;

              return (
                <button
                  key={scene.address}
                  onClick={() => setSelectedAddress(String(scene.address))}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    selectedAddress === String(scene.address)
                      ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <Layers size={16} className="flex-shrink-0 text-purple-500" />
                  <span className="min-w-0 flex-1 truncate">{scene.name}</span>
                  <span className="flex-shrink-0 text-xs text-gray-400">
                    {memberCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedAddress ? (
          <SceneDetail address={selectedAddress} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-gray-400 dark:text-gray-500">
            <Layers size={48} className="mb-3 opacity-40" />
            <p className="text-sm">Select a scene to view details</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <Plus size={14} />
              Create Scene
            </button>
          </div>
        )}
      </div>

      {/* Create Scene Modal */}
      <CreateSceneModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={(addr) => {
          setSelectedAddress(addr);
          setShowCreateModal(false);
        }}
      />
    </div>
  );
}
