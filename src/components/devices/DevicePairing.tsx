/**
 * Device pairing panel — Z-Wave include/exclude and Insteon linking.
 * Guides users through the process of adding or removing devices.
 */
import { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { zwaveInclude, zwaveExclude } from '@/api/rest.ts';
import { setDeviceLinkMode, discoverNodes } from '@/api/soap.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { ConfirmDialog } from '@/components/common/ConfirmDialog.tsx';
import { useConfirm } from '@/hooks/useConfirm.ts';

type PairingMode = 'idle' | 'zwave-include' | 'zwave-exclude' | 'insteon-link' | 'discovering';
type PairingResult = 'none' | 'success' | 'timeout' | 'error';

export function DevicePairing() {
  const [mode, setMode] = useState<PairingMode>('idle');
  const [result, setResult] = useState<PairingResult>('none');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const initialNodeCount = useRef(0);
  const fetchAll = useDeviceStore((s) => s.fetchAll);
  const nodeCount = useDeviceStore((s) => s.nodes.length);
  const [confirmProps, confirm] = useConfirm();

  // Countdown timer for active pairing modes
  useEffect(() => {
    if (countdown <= 0 && mode !== 'idle' && mode !== 'discovering') {
      // Timeout — check if new devices appeared
      handlePairingComplete();
    }
    if (countdown <= 0) return;

    timerRef.current = setInterval(() => {
      setCountdown((c) => c - 1);
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [countdown, mode]);

  const handlePairingComplete = async () => {
    // Refresh device list to see if anything changed
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

    const resp = await setDeviceLinkMode(32); // 32 = Insteon linking
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
      // Discovery runs in background; wait then refresh
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
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Device Pairing</h3>

      {/* Action buttons */}
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
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
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
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
          <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
          <span className="text-sm text-green-800 dark:text-green-300">
            Device operation completed successfully. Check the device list for changes.
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
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
          <span className="text-sm text-amber-800 dark:text-amber-300">
            Timed out — no device changes detected. Make sure the device is in pairing mode and try again.
          </span>
        </div>
      )}

      {result === 'error' && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
          <XCircle size={16} className="text-red-600 dark:text-red-400" />
          <span className="text-sm text-red-800 dark:text-red-300">{error || 'An error occurred.'}</span>
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
        <h4 className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">Pairing Tips</h4>
        <ul className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <li>• <strong>Z-Wave:</strong> Device must be within range. Press the device button once for include/exclude.</li>
          <li>• <strong>Insteon:</strong> Press and hold the Set button on the device for 3 seconds until LED flashes.</li>
          <li>• <strong>Discovery:</strong> Useful after manually adding devices or resetting the network.</li>
          <li>• After pairing, the device may need a few minutes to be fully configured.</li>
        </ul>
      </div>

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
