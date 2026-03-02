/**
 * Hook for managing confirmation dialog state.
 * Returns [dialogProps, confirm] where confirm() returns a Promise<boolean>.
 */
import { useState, useCallback, useRef } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning';
}

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  variant: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export function useConfirm(): [ConfirmDialogState, (opts: ConfirmOptions) => Promise<boolean>] {
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const [state, setState] = useState<Omit<ConfirmDialogState, 'onConfirm' | 'onCancel'>>({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    variant: 'danger',
  });

  const handleConfirm = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setState({
      open: true,
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirm',
      variant: opts.variant ?? 'danger',
    });
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  return [
    { ...state, onConfirm: handleConfirm, onCancel: handleCancel },
    confirm,
  ];
}
