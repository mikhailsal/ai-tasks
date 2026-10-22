import { useEffect, useRef, useState } from 'react';
import type { MetaData } from '../../../src/schema/meta.js';
import type {
  BackupInfo,
  BackupValidation,
  RecoveryJobEnvelope,
} from '../../../src/schema/recovery.js';
import type { ProjectResource } from '../../../src/schema/projects.js';
import { loadProposal, type OperationProposal } from '../data/drafts.js';
import { errorMessage } from '../data/resources.js';
import {
  type BackupOperationState,
  backupProposalKey,
  createBackupOperation,
  restoreBackupOperation,
  retryBackupRestore,
  retryBackupOperation,
  settleBackupRestore,
} from './backups-operations-model.js';

export function useBackupOperations(metadata?: MetaData) {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<OperationProposal | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState<unknown>();
  const [job, setJob] = useState<RecoveryJobEnvelope | undefined>(undefined);
  const pendingRef = useRef<OperationProposal | undefined>(undefined);
  const sending = useRef(false);
  const acknowledgedCreate = useRef<BackupInfo | undefined>(undefined);
  const state: BackupOperationState = {
    metadata,
    ready,
    pendingRef,
    sending,
    acknowledgedCreate,
    setPending,
    setBusy,
    setStorageError,
    setError,
    setJob,
  };

  useEffect(() => {
    let active = true;
    void loadProposal(backupProposalKey)
      .then((stored) => {
        if (!active) return;
        pendingRef.current = stored;
        setPending(stored);
        setReady(true);
      })
      .catch((failure: unknown) => {
        if (active) setStorageError(errorMessage(failure));
      });
    return () => {
      active = false;
    };
  }, []);

  return {
    ready,
    pending,
    busy,
    storageError,
    error,
    job,
    create: (project: ProjectResource) => createBackupOperation(state, project),
    restore: (project: ProjectResource, validation: BackupValidation, text: string) =>
      restoreBackupOperation(state, project, validation, text),
    retryCreate: () => retryBackupOperation(state),
    retryRestore: () => retryBackupRestore(state),
    settleRestore: () => settleBackupRestore(state),
    clearError: () => setError(undefined),
  };
}
