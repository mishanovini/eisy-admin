/**
 * Devices page — split layout with tree on left, detail on right.
 * Supports selecting devices and scenes from the tree.
 */
import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Monitor } from 'lucide-react';
import { DeviceTree } from '@/components/tree/DeviceTree.tsx';
import { DeviceDetail } from './DeviceDetail.tsx';
import { SceneDetail } from '@/components/scenes/SceneDetail.tsx';
import { useDeviceStore } from '@/stores/device-store.ts';

export function DevicesPage() {
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'node' | 'scene' | 'folder'>('node');
  const [searchParams, setSearchParams] = useSearchParams();
  const sceneMap = useDeviceStore((s) => s.sceneMap);

  // Handle ?select=ADDRESS from search palette or battery page navigation
  useEffect(() => {
    const selectAddr = searchParams.get('select');
    if (selectAddr) {
      setSelectedAddress(selectAddr);
      // Determine if it's a scene or node
      setSelectedType(sceneMap.has(selectAddr) ? 'scene' : 'node');
      // Clear the param so refresh doesn't re-select
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, sceneMap]);

  const handleSelect = useCallback((address: string, type: 'node' | 'scene' | 'folder') => {
    setSelectedAddress(address);
    setSelectedType(type);
  }, []);

  return (
    <div className="-m-4 flex h-[calc(100%+2rem)]">
      {/* Tree panel */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <DeviceTree selectedAddress={selectedAddress} onSelect={handleSelect} />
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedAddress && selectedType === 'node' && (
          <DeviceDetail address={selectedAddress} />
        )}
        {selectedAddress && selectedType === 'scene' && (
          <SceneDetail address={selectedAddress} />
        )}
        {selectedAddress && selectedType === 'folder' && (
          <FolderPlaceholder />
        )}
        {!selectedAddress && <EmptyState />}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-gray-400 dark:text-gray-500">
      <Monitor size={48} className="mb-3 opacity-40" />
      <p className="text-sm">Select a device from the tree to view details</p>
    </div>
  );
}

function FolderPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-gray-400 dark:text-gray-500">
      <p className="text-sm">Folder selected — select a device or scene to view details</p>
    </div>
  );
}
