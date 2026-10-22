import type { Dispatch, SetStateAction } from 'react';
import type { MetaData } from '../../../src/schema/meta.js';
import {
  backupEnvelopeSchema,
  backupValidationSchema,
  recoveryJobEnvelopeSchema,
  type BackupInfo,
  type BackupValidation,
  type RecoveryJobEnvelope,
} from '../../../src/schema/recovery.js';
import type { ProjectResource } from '../../../src/schema/projects.js';
import type { JsonValue } from '../../../src/schema/values.js';
import { ApiClientError, getRecoveryJobApi, mutateApi } from '../data/api.js';
import {
  createDraft,
  deleteProposal,
  proposalFor,
  saveProposal,
  type OperationProposal,
} from '../data/drafts.js';
import { canMutate, connectivitySnapshot } from '../data/connectivity.js';
import { errorMessage } from '../data/resources.js';

export const backupProposalKey = 'recovery:backup-operations';
export type Mutable<Value> = { current: Value };
export type BackupOperationState = {
  metadata: MetaData | undefined;
  ready: boolean;
  pendingRef: Mutable<OperationProposal | undefined>;
  sending: Mutable<boolean>;
  acknowledgedCreate: Mutable<BackupInfo | undefined>;
  setPending: Dispatch<SetStateAction<OperationProposal | undefined>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setStorageError: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<unknown>>;
  setJob: Dispatch<SetStateAction<RecoveryJobEnvelope | undefined>>;
};

function isRestore(proposal: OperationProposal) {
  return proposal.path.endsWith('/backups/restore');
}
function writable(state: BackupOperationState) {
  const metadata = state.metadata;
  if (!state.ready || !metadata) {
    state.setError(new Error('Дождитесь загрузки актуальных данных перед операцией.'));
    return false;
  }
  const connectivity = connectivitySnapshot();
  if (!canMutate(metadata.database_epoch) || connectivity.epoch !== metadata.database_epoch) {
    state.setError(new Error('Операция доступна после синхронизации с текущей базой данных.'));
    return false;
  }
  return true;
}
function start(state: BackupOperationState, requireEmpty: boolean) {
  if (!writable(state) || state.sending.current) return false;
  if (requireEmpty && state.pendingRef.current) {
    state.setError(new Error('Сначала завершите или проверьте сохранённую операцию.'));
    return false;
  }
  state.sending.current = true;
  state.setBusy(true);
  state.setError(undefined);
  return true;
}
function finish(state: BackupOperationState) {
  state.sending.current = false;
  state.setBusy(false);
}
function makeProposal(
  state: BackupOperationState,
  project: ProjectResource,
  payload: JsonValue,
  path: string,
) {
  const metadata = state.metadata;
  if (!metadata) throw new Error('Metadata is unavailable');
  const draft = createDraft({
    key: backupProposalKey,
    fields: {},
    base: {
      database_epoch: metadata.database_epoch,
      expected_config_revision: project.config_revision,
      expected_settings_revision: metadata.settings_revision,
    },
  });
  return proposalFor(draft, { path, method: 'POST', payload }, state.pendingRef.current);
}
async function persist(state: BackupOperationState, request: OperationProposal) {
  await saveProposal(backupProposalKey, request);
  state.pendingRef.current = request;
  state.setPending(request);
}
async function clear(state: BackupOperationState) {
  await deleteProposal(backupProposalKey);
  state.pendingRef.current = undefined;
  state.setPending(undefined);
}
async function send(state: BackupOperationState, request: OperationProposal) {
  if (!state.metadata) throw new Error('Metadata is unavailable');
  return mutateApi({
    path: request.path,
    method: request.method,
    envelope: request.envelope,
    currentEpoch: state.metadata.database_epoch,
  });
}
async function clearAfterUnsent(state: BackupOperationState, failure: unknown) {
  if (!definitelyUnsent(failure) && !definitiveServerRejection(failure)) return;
  try {
    await clear(state);
  } catch (cleanupFailure) {
    state.setStorageError(errorMessage(cleanupFailure));
  }
}
function definitelyUnsent(failure: unknown) {
  return failure instanceof ApiClientError && failure.definitelyUnsent;
}
function definitiveServerRejection(failure: unknown) {
  return (
    failure instanceof ApiClientError &&
    !failure.retryable &&
    !['CONNECTION_ERROR', 'INVALID_RESPONSE', 'OFFLINE'].includes(failure.code)
  );
}
async function cleanupAcknowledgedCreate(state: BackupOperationState, info: BackupInfo) {
  state.acknowledgedCreate.current = info;
  try {
    await clear(state);
    state.acknowledgedCreate.current = undefined;
    state.setStorageError('');
  } catch (failure) {
    state.setStorageError(errorMessage(failure));
  }
}

export async function createBackupOperation(
  state: BackupOperationState,
  project: ProjectResource,
): Promise<BackupInfo | undefined> {
  if (!start(state, true)) return undefined;
  try {
    const request = makeProposal(
      state,
      project,
      {},
      `/projects/${encodeURIComponent(project.slug)}/backups`,
    );
    await persist(state, request);
    try {
      const info = backupEnvelopeSchema.parse(await send(state, request)).data;
      await cleanupAcknowledgedCreate(state, info);
      return info;
    } catch (failure) {
      await clearAfterUnsent(state, failure);
      throw failure;
    }
  } catch (failure) {
    state.setError(failure);
    return undefined;
  } finally {
    finish(state);
  }
}

export async function retryBackupOperation(
  state: BackupOperationState,
): Promise<BackupInfo | undefined> {
  const request = state.pendingRef.current;
  if (!request || isRestore(request) || !start(state, false)) return undefined;
  try {
    if (state.acknowledgedCreate.current) {
      const info = state.acknowledgedCreate.current;
      try {
        await clear(state);
        state.acknowledgedCreate.current = undefined;
        state.setStorageError('');
        return info;
      } catch (failure) {
        state.setStorageError(errorMessage(failure));
        return undefined;
      }
    }
    try {
      const info = backupEnvelopeSchema.parse(await send(state, request)).data;
      await cleanupAcknowledgedCreate(state, info);
      return info;
    } catch (failure) {
      state.setError(failure);
      return undefined;
    }
  } finally {
    finish(state);
  }
}

/** Exact restore replay is explicit and keeps the accepted proposal through every response. */
export async function retryBackupRestore(
  state: BackupOperationState,
): Promise<RecoveryJobEnvelope | undefined> {
  const request = state.pendingRef.current;
  if (!request || !isRestore(request) || !start(state, false)) return undefined;
  try {
    const accepted = recoveryJobEnvelopeSchema.parse(await send(state, request));
    state.setJob(accepted);
    return accepted;
  } catch (failure) {
    state.setError(failure);
    return undefined;
  } finally {
    finish(state);
  }
}

export async function restoreBackupOperation(
  state: BackupOperationState,
  project: ProjectResource,
  validation: BackupValidation,
  confirmationText: string,
): Promise<RecoveryJobEnvelope | undefined> {
  if (!start(state, true)) return undefined;
  try {
    const checked = backupValidationSchema.parse(validation);
    const request = makeProposal(
      state,
      project,
      {
        backup_id: checked.backup.id,
        affected_projects: checked.affected_projects,
        confirmation: { asserted: true, user_text: confirmationText },
      },
      `/projects/${encodeURIComponent(project.slug)}/backups/restore`,
    );
    await persist(state, request);
    try {
      const accepted = recoveryJobEnvelopeSchema.parse(await send(state, request));
      state.setJob(accepted);
      return accepted;
    } catch (failure) {
      await clearAfterUnsent(state, failure);
      throw failure;
    }
  } catch (failure) {
    state.setError(failure);
    return undefined;
  } finally {
    finish(state);
  }
}

export async function settleBackupRestore(state: BackupOperationState): Promise<void> {
  const request = state.pendingRef.current;
  if (!request || !isRestore(request)) return;
  const current = recoveryJobEnvelopeSchema.parse(
    await getRecoveryJobApi({ operationId: request.envelope.operation_id }),
  );
  state.setJob(current);
  if (current.data.state === 'queued' || current.data.state === 'running') return;
  await clear(state);
}
