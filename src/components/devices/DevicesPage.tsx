/**
 * Devices page — split layout with tree on left, detail on right.
 * Supports selecting devices and scenes from the tree, plus device pairing.
 *
 * Drag & drop: device nodes can be dragged onto scene nodes in the tree.
 * A role selection modal (Controller / Responder) appears before the SOAP call.
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Monitor, Plus, Layers, Loader2, X } from 'lucide-react';
import { DeviceTree } from '@/components/tree/DeviceTree.tsx';
import { DeviceDetail } from './DeviceDetail.tsx';
import { DevicePairing } from './DevicePairing.tsx';
import { SceneDetail } from '@/components/scenes/SceneDetail.tsx';
import { useDeviceStore } from '@/stores/device-store.ts';
import { moveNode, setParent } from '@/api/soap.ts';
import { ISY_NODE_TYPE } from '@/components/tree/TreeNode.tsx';
import { getControllerAddresses } from '@/utils/scene-utils.ts';

/** Pending drop state — stored while the role modal is open */
interface PendingDrop {
  nodeAddress: string;
  nodeName: string;
  sceneAddress: string;
  sceneName: string;
}

export function DevicesPage() {
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'node' | 'scene' | 'folder' | 'pairing'>('node');
  const [searchParams, setSearchParams] = useSearchParams();
  const sceneMap = useDeviceStore((s) => s.sceneMap);
  const scenes = useDeviceStore((s) => s.scenes);
  const fetchAll = useDeviceStore((s) => s.fetchAll);

  // Set of device addresses that are already controllers in some scene
  const existingControllers = useMemo(() => getControllerAddresses(scenes), [scenes]);

  // Drag & drop role selection state
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [dropBusy, setDropBusy] = useState(false);
  const [dropError, setDropError] = useState('');

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

  const handleAddDevice = useCallback(() => {
    setSelectedAddress(null);
    setSelectedType('pairing');
  }, []);

  /** Called from DevicePairing after a device is successfully added */
  const handleDeviceAdded = useCallback((address: string) => {
    setSelectedAddress(address);
    setSelectedType('node');
  }, []);

  /** Called when a device is dropped onto a scene in the tree — opens role modal */
  const handleDropOnScene = useCallback(
    (nodeAddress: string, nodeName: string, sceneAddress: string, sceneName: string) => {
      setPendingDrop({ nodeAddress, nodeName, sceneAddress, sceneName });
      setDropError('');
    },
    [],
  );

  /** User picks a role in the modal — execute the SOAP call */
  const handleRoleSelected = useCallback(
    async (role: 'controller' | 'responder') => {
      if (!pendingDrop) return;
      setDropBusy(true);
      setDropError('');
      try {
        const result = await moveNode(pendingDrop.nodeAddress, pendingDrop.sceneAddress, role);
        if (result.success) {
          await fetchAll();
          setPendingDrop(null);
        } else {
          setDropError(result.info ?? 'Failed to add device to scene.');
        }
      } catch (err) {
        setDropError(err instanceof Error ? err.message : 'Failed to add device to scene.');
      } finally {
        setDropBusy(false);
      }
    },
    [pendingDrop, fetchAll],
  );

  const handleCancelDrop = useCallback(() => {
    setPendingDrop(null);
    setDropError('');
    setDropBusy(false);
  }, []);

  /** Called when a device/scene is dropped onto a folder — move it */
  const handleMoveToFolder = useCallback(
    async (itemAddress: string, _itemName: string, itemType: 'node' | 'scene', folderAddress: string) => {
      const nodeType = itemType === 'scene' ? ISY_NODE_TYPE.GROUP : ISY_NODE_TYPE.NODE;
      try {
        const result = await setParent(itemAddress, nodeType, folderAddress, ISY_NODE_TYPE.FOLDER);
        if (result.success) {
          await fetchAll();
        } else {
          console.warn('[DnD] SetParent failed:', result.info);
        }
      } catch (err) {
        console.error('[DnD] SetParent error:', err);
      }
    },
    [fetchAll],
  );

  return (
    <div className="-m-4 flex h-[calc(100%+2rem)]">
      {/* Tree panel */}
      <div className="flex w-72 flex-shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        {/* Add Device button */}
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Devices</span>
          <button
            onClick={handleAddDevice}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              selectedType === 'pairing'
                ? 'bg-blue-600 text-white'
                : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20'
            }`}
            title="Add Device"
          >
            <Plus size={14} />
            Add Device
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <DeviceTree
            selectedAddress={selectedAddress}
            onSelect={handleSelect}
            onDropOnScene={handleDropOnScene}
            onMoveToFolder={handleMoveToFolder}
          />
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedType === 'pairing' && (
          <DevicePairing onDeviceAdded={handleDeviceAdded} />
        )}
        {selectedAddress && selectedType === 'node' && (
          <DeviceDetail address={selectedAddress} />
        )}
        {selectedAddress && selectedType === 'scene' && (
          <SceneDetail address={selectedAddress} />
        )}
        {selectedAddress && selectedType === 'folder' && (
          <FolderPlaceholder />
        )}
        {!selectedAddress && selectedType !== 'pairing' && <EmptyState onAddDevice={handleAddDevice} />}
      </div>

      {/* Drag & Drop Role Selection Modal */}
      {pendingDrop && (
        <DropRoleModal
          nodeName={pendingDrop.nodeName}
          sceneName={pendingDrop.sceneName}
          isAlreadyController={existingControllers.has(pendingDrop.nodeAddress)}
          busy={dropBusy}
          error={dropError}
          onSelectRole={handleRoleSelected}
          onCancel={handleCancelDrop}
        />
      )}
    </div>
  );
}

function EmptyState({ onAddDevice }: { onAddDevice: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-gray-400 dark:text-gray-500">
      <Monitor size={48} className="mb-3 opacity-40" />
      <p className="text-sm">Select a device from the tree to view details</p>
      <button
        onClick={onAddDevice}
        className="mt-3 flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
      >
        <Plus size={14} />
        Add Device
      </button>
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

/* ─── Drag & Drop Role Selection Modal ────────────────────── */

/**
 * Shown when a device is dragged onto a scene in the tree.
 * The user must choose a role (Controller or Responder) before
 * the device can be added to the scene via SOAP MoveNode.
 */
function DropRoleModal({
  nodeName,
  sceneName,
  isAlreadyController,
  busy,
  error,
  onSelectRole,
  onCancel,
}: {
  nodeName: string;
  sceneName: string;
  /** True if this device is already a controller for another scene */
  isAlreadyController: boolean;
  busy: boolean;
  error: string;
  onSelectRole: (role: 'controller' | 'responder') => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={busy ? undefined : onCancel} />

      {/* Modal */}
      <div className="relative mx-4 w-full max-w-sm rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
              <Layers size={16} className="text-purple-600 dark:text-purple-400" />
            </div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Add to Scene
            </h2>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Add <span className="font-semibold text-gray-900 dark:text-gray-100">{nodeName}</span>{' '}
            to <span className="font-semibold text-purple-600 dark:text-purple-400">{sceneName}</span>?
          </p>

          {isAlreadyController ? (
            <>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                This device will be added as a <span className="font-semibold">Responder</span>.
              </p>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                This device is already a controller for another scene. A device can only be a controller for one scene.
              </p>

              {/* Single Responder button */}
              <div className="mt-4">
                <button
                  onClick={() => onSelectRole('responder')}
                  disabled={busy}
                  className="flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-gray-200 px-4 py-3 transition-colors hover:border-purple-400 hover:bg-purple-50 disabled:opacity-50 dark:border-gray-600 dark:hover:border-purple-500 dark:hover:bg-purple-900/20"
                >
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Add as Responder</span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">Reacts to scene commands</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Choose a role for this device in the scene:
              </p>

              {/* Role buttons */}
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => onSelectRole('responder')}
                  disabled={busy}
                  className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border-2 border-gray-200 px-4 py-3 transition-colors hover:border-purple-400 hover:bg-purple-50 disabled:opacity-50 dark:border-gray-600 dark:hover:border-purple-500 dark:hover:bg-purple-900/20"
                >
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Responder</span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">Reacts to scene commands</span>
                </button>
                <button
                  onClick={() => onSelectRole('controller')}
                  disabled={busy}
                  className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border-2 border-gray-200 px-4 py-3 transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50 dark:border-gray-600 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
                >
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Controller</span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">Initiates scene activation</span>
                </button>
              </div>
            </>
          )}

          {/* Loading indicator */}
          {busy && (
            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 size={14} className="animate-spin" />
              Adding to scene...
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
