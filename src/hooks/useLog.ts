/**
 * Event logging hook — convenience wrapper around log-store.
 */
import { useCallback } from 'react';
import { useLogStore } from '@/stores/log-store.ts';
import type { LogCategory, LogResult } from '@/stores/log-store.ts';

interface LogOptions {
  device?: string;
  deviceName?: string;
  source?: string;
  detail?: string;
  rawCommand?: string;
}

/** Convenience hook for logging events */
export function useLog() {
  const addEntry = useLogStore((s) => s.addEntry);

  const logCommand = useCallback(
    (action: string, result: LogResult, options?: LogOptions) =>
      addEntry({
        category: 'command' as LogCategory,
        action,
        result,
        source: options?.source ?? 'manual',
        ...options,
      }),
    [addEntry],
  );

  const logComms = useCallback(
    (action: string, result: LogResult, options?: LogOptions) =>
      addEntry({
        category: 'comms' as LogCategory,
        action,
        result,
        source: options?.source ?? 'system',
        ...options,
      }),
    [addEntry],
  );

  const logProgram = useCallback(
    (action: string, result: LogResult, options?: LogOptions) =>
      addEntry({
        category: 'program' as LogCategory,
        action,
        result,
        source: options?.source ?? 'program',
        ...options,
      }),
    [addEntry],
  );

  return { logCommand, logComms, logProgram };
}
