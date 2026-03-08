/**
 * Modal for creating a new scene/group.
 *
 * 2-step flow:
 * 1. Enter scene name
 * 2. Pick member devices with controller/responder roles
 *
 * Uses SOAP AddGroup + sequential MoveNode calls to build the scene
 * on the eisy device, then refreshes the store.
 */
import { useState, useMemo } from 'react';
import {
  X,
  Layers,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { addGroup, moveNode } from '@/api/soap.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { nextSceneAddress } from '@/utils/id-gen.ts';
import { getControllerAddresses } from '@/utils/scene-utils.ts';

interface CreateSceneModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (sceneAddress: string) => void;
}

interface SelectedMember {
  address: string;
  name: string;
  role: 'controller' | 'responder';
}

export function CreateSceneModal({ open, onClose, onCreated }: CreateSceneModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [sceneName, setSceneName] = useState('');
  const [members, setMembers] = useState<Map<string, SelectedMember>>(new Map());
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const nodes = useDeviceStore((s) => s.nodes);
  const scenes = useDeviceStore((s) => s.scenes);
  const fetchAll = useDeviceStore((s) => s.fetchAll);

  // Devices that are already a controller in any scene — can't be controller again
  const existingControllers = useMemo(() => getControllerAddresses(scenes), [scenes]);

  // Filter to actual devices (exclude scenes and folders)
  const deviceList = useMemo(() => {
    const lf = filter.toLowerCase();
    return nodes
      .filter((n) => {
        // Basic filter
        if (lf && !n.name.toLowerCase().includes(lf) && !String(n.address).toLowerCase().includes(lf)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [nodes, filter]);

  const toggleMember = (address: string, name: string) => {
    setMembers((prev) => {
      const next = new Map(prev);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.set(address, { address, name, role: 'responder' });
      }
      return next;
    });
  };

  const setMemberRole = (address: string, role: 'controller' | 'responder') => {
    // Enforce Insteon constraint: can't be controller for multiple scenes
    if (role === 'controller' && existingControllers.has(address)) return;

    setMembers((prev) => {
      const next = new Map(prev);
      const existing = next.get(address);
      if (existing) {
        next.set(address, { ...existing, role });
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (!sceneName.trim()) return;
    setCreating(true);
    setError('');

    try {
      // Generate the next available scene address
      const addr = nextSceneAddress(scenes);

      // Step 1: Create the scene/group
      const groupResult = await addGroup(addr, sceneName.trim());
      if (!groupResult.success) {
        setError(groupResult.info ?? 'Failed to create scene.');
        setCreating(false);
        return;
      }

      // Step 2: Add members one by one via MoveNode
      const memberEntries = Array.from(members.values());
      for (const member of memberEntries) {
        const moveResult = await moveNode(member.address, addr, member.role);
        if (!moveResult.success) {
          // Log but continue — partial membership is still useful
          console.warn(`[CreateScene] Failed to add member ${member.address}:`, moveResult.info);
        }
      }

      // Refresh the device store to show the new scene
      await fetchAll();

      setSuccess(true);
      onCreated?.(addr);

      // Auto-close after a brief delay
      setTimeout(() => {
        handleClose();
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create scene.');
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    // Reset state
    setStep(1);
    setSceneName('');
    setMembers(new Map());
    setFilter('');
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
      <div className="relative mx-4 flex w-full max-w-lg flex-col rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
        style={{ maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
              <Layers size={16} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Create New Scene
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Step {step} of 2 — {step === 1 ? 'Name your scene' : 'Add members'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Scene Name
                </label>
                <input
                  type="text"
                  value={sceneName}
                  onChange={(e) => setSceneName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && sceneName.trim()) setStep(2);
                  }}
                  placeholder="e.g. Living Room All On"
                  autoFocus
                  className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose a descriptive name for your scene. You can add member devices in the next step.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              {/* Search filter */}
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter devices..."
                  autoFocus
                  className="w-full rounded-lg border border-gray-300 bg-transparent py-2 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
                />
              </div>

              {/* Selected count */}
              {members.size > 0 && (
                <p className="text-xs font-medium text-purple-600 dark:text-purple-400">
                  {members.size} device{members.size !== 1 ? 's' : ''} selected
                </p>
              )}

              {/* Device list */}
              <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                {deviceList.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-gray-400">
                    {filter ? 'No devices match your filter.' : 'No devices found.'}
                  </p>
                ) : (
                  deviceList.map((node) => {
                    const addr = String(node.address);
                    const selected = members.has(addr);
                    const member = members.get(addr);

                    return (
                      <div
                        key={addr}
                        className={`flex items-center gap-2 px-3 py-2 transition-colors ${
                          selected
                            ? 'bg-purple-50 dark:bg-purple-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleMember(addr, node.name)}
                          className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
                          {node.name}
                        </span>
                        {selected && (
                          existingControllers.has(addr) ? (
                            <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              Responder
                              <span className="text-[10px] text-amber-600 dark:text-amber-400" title="Already a controller in another scene">
                                (ctrl in use)
                              </span>
                            </span>
                          ) : (
                            <select
                              value={member?.role ?? 'responder'}
                              onChange={(e) => setMemberRole(addr, e.target.value as 'controller' | 'responder')}
                              className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                            >
                              <option value="responder">Responder</option>
                              <option value="controller">Controller</option>
                            </select>
                          )
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
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
            <span className="text-xs text-green-700 dark:text-green-300">Scene created successfully!</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          {step === 1 ? (
            <>
              <button
                onClick={handleClose}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={!sceneName.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-purple-700 disabled:opacity-50 dark:bg-purple-500 dark:hover:bg-purple-600"
              >
                Next
                <ArrowRight size={14} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep(1)}
                disabled={creating}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || success}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-purple-700 disabled:opacity-50 dark:bg-purple-500 dark:hover:bg-purple-600"
              >
                {creating ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Scene'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
