/**
 * Device pairing panel — Z-Wave include/exclude, Insteon linking,
 * and direct "Add by Address" for Insteon devices.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus,
  Minus,
  Link2,
  Radio,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Hash,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { zwaveInclude, zwaveExclude } from '@/api/rest.ts';
import { setDeviceLinkMode, discoverNodes, addNode } from '@/api/soap.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { ConfirmDialog } from '@/components/common/ConfirmDialog.tsx';
import { useConfirm } from '@/hooks/useConfirm.ts';

type PairingMode = 'idle' | 'zwave-include' | 'zwave-exclude' | 'insteon-link' | 'discovering';
type PairingResult = 'none' | 'success' | 'timeout' | 'error';

interface DevicePairingProps {
  /** Called when a device is successfully added by address */
  onDeviceAdded?: (address: string) => void;
}

/** Validate a single hex octet (1-2 hex chars) */
function isValidHex(val: string): boolean {
  return /^[0-9a-fA-F]{1,2}$/.test(val);
}

export function DevicePairing({ onDeviceAdded }: DevicePairingProps) {
  const [mode, setMode] = useState<PairingMode>('idle');
  const [result, setResult] = useState<PairingResult>('none');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const initialNodeCount = useRef(0);
  const fetchAll = useDeviceStore((s) => s.fetchAll);
  const nodeCount = useDeviceStore((s) => s.nodes.length);
  const [confirmProps, confirm] = useConfirm();

  // ─── Add by Address state ───────────────────────────────────
  const [addrOctet1, setAddrOctet1] = useState('');
  const [addrOctet2, setAddrOctet2] = useState('');
  const [addrOctet3, setAddrOctet3] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ntype, setNtype] = useState(1);
  const [family, setFamily] = useState(1);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<'none' | 'success' | 'error'>('none');
  const [addError, setAddError] = useState('');

  const octet2Ref = useRef<HTMLInputElement>(null);
  const octet3Ref = useRef<HTMLInputElement>(null);

  /** Auto-advance to next octet when 2 chars entered */
  const handleOctetChange = useCallback((value: string, octet: 1 | 2 | 3) => {
    const clean = value.replace(/[^0-9a-fA-F]/g, '').slice(0, 2).toUpperCase();
    if (octet === 1) {
      setAddrOctet1(clean);
      if (clean.length === 2) octet2Ref.current?.focus();
    } else if (octet === 2) {
      setAddrOctet2(clean);
      if (clean.length === 2) octet3Ref.current?.focus();
    } else {
      setAddrOctet3(clean);
    }
  }, []);

  const isAddressValid = isValidHex(addrOctet1) && isValidHex(addrOctet2) && isValidHex(addrOctet3);
  const canAdd = isAddressValid && deviceName.trim().length > 0 && !adding;

  const handleAddByAddress = async () => {
    if (!canAdd) return;
    setAdding(true);
    setAddResult('none');
    setAddError('');

    // Pad each octet to 2 chars
    const addr = `${addrOctet1.padStart(2, '0')}.${addrOctet2.padStart(2, '0')}.${addrOctet3.padStart(2, '0')}`;

    const resp = await addNode(addr, deviceName.trim(), ntype, family);

    if (resp.success) {
      setAddResult('success');
      // Refresh device store so the new device appears in the tree
      await fetchAll();
      // Notify parent to select the new device
      // Convert "1A.2B.3C" → "1A 2B 3C 1" which is what the eisy uses as address
      const eisyAddr = addr.replace(/\./g, ' ') + ' 1';
      onDeviceAdded?.(eisyAddr);
      // Reset form
      setAddrOctet1('');
      setAddrOctet2('');
      setAddrOctet3('');
      setDeviceName('');
    } else {
      setAddResult('error');
      setAddError(resp.info ?? 'Failed to add device. Check the address and try again.');
    }

    setAdding(false);
  };

  // ─── Z-Wave / Insteon Link / Discovery ──────────────────────

  // Countdown timer for active pairing modes
  useEffect(() => {
    if (countdown <= 0 && mode !== 'idle' && mode !== 'discovering') {
      handlePairingComplete();
    }
    if (countdown <= 0) return;

    timerRef.current = setInterval(() => {
      setCountdown((c) => c - 1);
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [countdown, mode]);

  const handlePairingComplete = async () => {
    await fetchAll();
    const newCount = useDeviceStore.getState().nodes.length;

    if (mode === 'zwave-include' || mode === 'insteon-link') {
      if (newCount > initialNodeCount.current) {
        setResult('success');
      } else {
        setResult('timeout');
      }
    } else if (mode === 'zwave-exclude') {
      if (newCount < initialNodeCount.current) {
        setResult('success');
      } else {
        setResult('timeout');
      }
    }
    setMode('idle');
  };

  const startZWaveInclude = async () => {
    setResult('none');
    setError('');
    initialNodeCount.current = nodeCount;

    const ok = await zwaveInclude();
    if (ok) {
      setMode('zwave-include');
      setCountdown(60);
    } else {
      setError('Failed to start Z-Wave inclusion mode.');
      setResult('error');
    }
  };

  const startZWaveExclude = async () => {
    const ok = await confirm({
      title: 'Z-Wave Exclusion',
      message: 'This will remove a Z-Wave device from the network. The device must be triggered during exclusion. Continue?',
      confirmLabel: 'Start Exclusion',
      variant: 'warning',
    });
    if (!ok) return;

    setResult('none');
    setError('');
    initialNodeCount.current = nodeCount;

    const success = await zwaveExclude();
    if (success) {
      setMode('zwave-exclude');
      setCountdown(60);
    } else {
      setError('Failed to start Z-Wave exclusion mode.');
      setResult('error');
    }
  };

  const startInsteonLink = async () => {
    setResult('none');
    setError('');
    initialNodeCount.current = nodeCount;

    const resp = await setDeviceLinkMode(32);
    if (resp.success) {
      setMode('insteon-link');
      setCountdown(60);
    } else {
      setError('Failed to start Insteon linking mode.');
      setResult('error');
    }
  };

  const startDiscovery = async () => {
    setResult('none');
    setError('');
    setMode('discovering');

    const resp = await discoverNodes();
    if (resp.success) {
      setTimeout(async () => {
        await fetchAll();
        setMode('idle');
        setResult('success');
      }, 10_000);
    } else {
      setError('Failed to start device discovery.');
      setResult('error');
      setMode('idle');
    }
  };

  const cancelPairing = () => {
    setMode('idle');
    setCountdown(0);
    clearInterval(timerRef.current);
  };

  const isActive = mode !== 'idle';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add Device</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Add a new device by entering its Insteon address, or use pairing mode for Z-Wave and Insteon devices.
        </p>
      </div>

      {/* ─── Add by Address (Insteon) ──────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30">
            <Hash size={16} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Add Insteon Device by Address</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Enter the 6-character Insteon address from the device label</p>
          </div>
        </div>

        <div className="space-y-3">
          {/* Address input — three hex octets */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Device Address
            </label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={addrOctet1}
                onChange={(e) => handleOctetChange(e.target.value, 1)}
                placeholder="1A"
                maxLength={2}
                className="w-14 rounded-lg border border-gray-300 bg-transparent px-2 py-2 text-center font-mono text-sm uppercase text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
              />
              <span className="text-gray-400 font-mono">.</span>
              <input
                ref={octet2Ref}
                type="text"
                value={addrOctet2}
                onChange={(e) => handleOctetChange(e.target.value, 2)}
                placeholder="2B"
                maxLength={2}
                className="w-14 rounded-lg border border-gray-300 bg-transparent px-2 py-2 text-center font-mono text-sm uppercase text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
              />
              <span className="text-gray-400 font-mono">.</span>
              <input
                ref={octet3Ref}
                type="text"
                value={addrOctet3}
                onChange={(e) => handleOctetChange(e.target.value, 3)}
                placeholder="3C"
                maxLength={2}
                className="w-14 rounded-lg border border-gray-300 bg-transparent px-2 py-2 text-center font-mono text-sm uppercase text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
              />
            </div>
          </div>

          {/* Device name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Device Name
            </label>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. Living Room Dimmer"
              className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
            />
          </div>

          {/* Advanced options (collapsed) */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Advanced Options
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Device Type
                </label>
                <select
                  value={ntype}
                  onChange={(e) => setNtype(Number(e.target.value))}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value={1}>Auto-detect (1)</option>
                  <option value={0}>Unknown (0)</option>
                  <option value={2}>Dimmer (2)</option>
                  <option value={3}>Switch (3)</option>
                  <option value={5}>Thermostat (5)</option>
                  <option value={7}>I/O (7)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Family
                </label>
                <select
                  value={family}
                  onChange={(e) => setFamily(Number(e.target.value))}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value={1}>Insteon (1)</option>
                  <option value={0}>Generic (0)</option>
                </select>
              </div>
            </div>
          )}

          {/* Add button */}
          <button
            onClick={handleAddByAddress}
            disabled={!canAdd}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            {adding ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Adding Device...
              </>
            ) : (
              <>
                <Plus size={14} />
                Add Device
              </>
            )}
          </button>

          {/* Add result feedback */}
          {addResult === 'success' && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
              <CheckCircle2 size={14} className="flex-shrink-0 text-green-600 dark:text-green-400" />
              <span className="text-sm text-green-800 dark:text-green-300">
                Device added successfully!
              </span>
            </div>
          )}

          {addResult === 'error' && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <XCircle size={14} className="flex-shrink-0 text-red-600 dark:text-red-400" />
              <span className="text-sm text-red-800 dark:text-red-300">{addError}</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── Protocol Pairing ──────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Protocol Pairing</h3>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={startZWaveInclude}
            disabled={isActive}
            className="flex items-center gap-2 rounded-lg border border-gray-200 p-3 text-left text-sm transition-colors hover:bg-blue-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-blue-900/20"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
              <Plus size={16} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="font-medium text-gray-900 dark:text-gray-100">Z-Wave Include</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Add a Z-Wave device</div>
            </div>
          </button>

          <button
            onClick={startZWaveExclude}
            disabled={isActive}
            className="flex items-center gap-2 rounded-lg border border-gray-200 p-3 text-left text-sm transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-red-900/20"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <Minus size={16} className="text-red-600 dark:text-red-400" />
            </div>
            <div>
              <div className="font-medium text-gray-900 dark:text-gray-100">Z-Wave Exclude</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Remove a Z-Wave device</div>
            </div>
          </button>

          <button
            onClick={startInsteonLink}
            disabled={isActive}
            className="flex items-center gap-2 rounded-lg border border-gray-200 p-3 text-left text-sm transition-colors hover:bg-green-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-green-900/20"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <Link2 size={16} className="text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div className="font-medium text-gray-900 dark:text-gray-100">Insteon Link</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Link an Insteon device</div>
            </div>
          </button>

          <button
            onClick={startDiscovery}
            disabled={isActive}
            className="flex items-center gap-2 rounded-lg border border-gray-200 p-3 text-left text-sm transition-colors hover:bg-amber-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-amber-900/20"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <Radio size={16} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="font-medium text-gray-900 dark:text-gray-100">Discover</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Scan for new devices</div>
            </div>
          </button>
        </div>

        {/* Active pairing status */}
        {isActive && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                  {mode === 'zwave-include' && 'Z-Wave Inclusion Mode Active'}
                  {mode === 'zwave-exclude' && 'Z-Wave Exclusion Mode Active'}
                  {mode === 'insteon-link' && 'Insteon Linking Mode Active'}
                  {mode === 'discovering' && 'Discovering Devices...'}
                </span>
              </div>
              {countdown > 0 && (
                <span className="text-sm font-mono text-blue-600 dark:text-blue-400">{countdown}s</span>
              )}
            </div>

            <p className="mt-2 text-xs text-blue-700 dark:text-blue-400">
              {mode === 'zwave-include' && 'Press the button on your Z-Wave device to add it to the network.'}
              {mode === 'zwave-exclude' && 'Press the button on the Z-Wave device you want to remove.'}
              {mode === 'insteon-link' && 'Press and hold the Set button on your Insteon device for 3 seconds.'}
              {mode === 'discovering' && 'Scanning the network for new devices. This may take a moment.'}
            </p>

            {mode !== 'discovering' && (
              <button
                onClick={cancelPairing}
                className="mt-2 rounded border border-blue-300 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/40"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {/* Result feedback */}
        {result === 'success' && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
            <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
            <span className="text-sm text-green-800 dark:text-green-300">
              Device operation completed successfully.
            </span>
            <button
              onClick={() => fetchAll()}
              className="ml-auto flex items-center gap-1 rounded border border-green-300 px-2 py-1 text-xs text-green-700 hover:bg-green-100 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/40"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        )}

        {result === 'timeout' && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
            <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-800 dark:text-amber-300">
              Timed out — no device changes detected. Make sure the device is in pairing mode and try again.
            </span>
          </div>
        )}

        {result === 'error' && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
            <XCircle size={16} className="text-red-600 dark:text-red-400" />
            <span className="text-sm text-red-800 dark:text-red-300">{error || 'An error occurred.'}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <h4 className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">Tips</h4>
        <ul className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <li>• <strong>Add by Address:</strong> Enter the Insteon address printed on the device label (e.g. 1A.2B.3C).</li>
          <li>• <strong>Z-Wave:</strong> Device must be within range. Press the device button once for include/exclude.</li>
          <li>• <strong>Insteon Link:</strong> Press and hold the Set button on the device for 3 seconds until LED flashes.</li>
          <li>• <strong>Discovery:</strong> Useful after manually adding devices or resetting the network.</li>
          <li>• After adding, the device may need a few minutes to be fully configured.</li>
        </ul>
      </div>

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
