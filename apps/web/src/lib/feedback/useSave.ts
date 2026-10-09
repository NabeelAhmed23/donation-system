import { useRef, useState } from 'react';
import { describeFailure, type FailureMessage } from './describeFailure';

export type SaveStatus = 'idle' | 'saving' | 'succeeded' | 'failed';

export type SaveOutcome<TResult> = { ok: true; result: TResult } | { ok: false; failure: FailureMessage };

export interface UseSaveOptions<TArgs extends unknown[], TResult> {
  /** Completes "You do not have permission to …", e.g. "cancel this donation". */
  action: string;
  onSuccess?: (result: TResult, ...args: TArgs) => void;
  /** Called on a 401 so the caller can stash unsaved input before the user signs in again. */
  onSessionExpired?: (...args: TArgs) => void;
}

/**
 * Runs a save and reports whether it worked. It never touches the caller's form state, so the
 * user's input survives every failure. A second call while one is in flight is ignored.
 */
export function useSave<TArgs extends unknown[], TResult>(
  save: (...args: TArgs) => Promise<TResult>,
  options: UseSaveOptions<TArgs, TResult>,
) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [failure, setFailure] = useState<FailureMessage>();
  const inFlight = useRef(false);

  async function run(...args: TArgs): Promise<SaveOutcome<TResult> | undefined> {
    if (inFlight.current) {
      return undefined;
    }
    inFlight.current = true;
    setStatus('saving');
    setFailure(undefined);

    let result: TResult;
    try {
      result = await save(...args);
    } catch (error) {
      const described = describeFailure(error, options.action);
      setStatus('failed');
      setFailure(described);
      if (described.kind === 'session-expired') {
        options.onSessionExpired?.(...args);
      }
      return { ok: false, failure: described };
    } finally {
      inFlight.current = false;
    }

    setStatus('succeeded');
    options.onSuccess?.(result, ...args);
    return { ok: true, result };
  }

  function reset() {
    setStatus('idle');
    setFailure(undefined);
  }

  return { status, failure, saving: status === 'saving', run, reset };
}
