import { useEffect, useRef, useState } from 'react';
import { ApiClientError, mutateApi } from '../data/api.js';
import {
  loadProposal,
  saveProposal,
  deleteProposal,
  type OperationProposal,
} from '../data/drafts.js';
import { errorMessage } from '../data/resources.js';

export function isProjectConflict(error: unknown) {
  return (
    error instanceof ApiClientError &&
    ['REVISION_CONFLICT', 'CONFIG_CONFLICT', 'DATABASE_EPOCH_CONFLICT'].includes(error.code)
  );
}
function definitive(error: unknown) {
  return (
    error instanceof ApiClientError &&
    !error.retryable &&
    !['CONNECTION_ERROR', 'INVALID_RESPONSE', 'OFFLINE'].includes(error.code)
  );
}
function clearable(error: unknown, hadPrevious: boolean) {
  if (error instanceof ApiClientError && error.definitelyUnsent) return !hadPrevious;
  return definitive(error);
}
function sameProposal(left: OperationProposal, right: OperationProposal) {
  return left.body === right.body && left.path === right.path && left.method === right.method;
}
/** Pending proposals are retried only by an explicit user action, including after reload. */
export function useProjectOperation(key: string, currentEpoch: string) {
  const [pending, setPending] = useState<OperationProposal>();
  const pendingRef = useRef<OperationProposal | undefined>(undefined);
  const [acknowledged, setAcknowledged] = useState(false);
  const saved = useRef(false);
  const reviewedEpoch = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    let active = true;
    void loadProposal(key)
      .then((stored) => {
        if (active) {
          pendingRef.current = stored;
          setPending(stored);
          setReady(true);
        }
      })
      .catch((error: unknown) => {
        if (active) setStorageError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [key]);
  async function clear() {
    await deleteProposal(key);
    pendingRef.current = undefined;
    setPending(undefined);
  }
  async function run(request: OperationProposal, explicitlyReviewedEpoch?: string) {
    if (sending.current) throw new Error('Сохранение уже выполняется.');
    const previous = pendingRef.current;
    if (previous && !sameProposal(previous, request))
      throw new Error('Сначала повторите прежнюю операцию, чтобы узнать её результат.');
    if (explicitlyReviewedEpoch !== undefined) reviewedEpoch.current = explicitlyReviewedEpoch;
    sending.current = true;
    setBusy(true);
    try {
      if (!previous || !saved.current) {
        saved.current = false;
        setAcknowledged(false);
        await saveProposal(key, request);
        pendingRef.current = request;
        setPending(request);
        await mutateApi({ ...request, currentEpoch: reviewedEpoch.current ?? currentEpoch });
        saved.current = true;
        setAcknowledged(true);
      }
      await clear();
    } catch (error) {
      if (!saved.current && clearable(error, previous !== undefined)) await clear();
      throw error;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function cleanup() {
    if (pendingRef.current) await clear();
  }
  return {
    cleanup,
    pending,
    acknowledged,
    ready,
    busy,
    storageError,
    run,
    wasSaved: () => saved.current,
  };
}
