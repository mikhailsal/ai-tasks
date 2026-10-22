import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../web/src/data/api.js';
import type * as ApiModule from '../../web/src/data/api.js';
import type * as DraftsModule from '../../web/src/data/drafts.js';
import { updateConnectivity } from '../../web/src/data/connectivity.js';
import type { OperationProposal } from '../../web/src/data/drafts.js';
import { backupValidationSchema, recoveryJobEnvelopeSchema } from '../../src/schema/recovery.js';
import { metaDataSchema } from '../../src/schema/meta.js';
import { projectResourceSchema } from '../../src/schema/projects.js';
import {
  createBackupOperation,
  retryBackupRestore,
  restoreBackupOperation,
  retryBackupOperation,
  settleBackupRestore,
  type BackupOperationState,
} from '../../web/src/screens/backups-operations-model.js';

const mocked = vi.hoisted(() => ({
  mutateApi: vi.fn(),
  getRecoveryJobApi: vi.fn(),
  proposalStorage: new Map<string, unknown>(),
  events: [] as string[],
  failDelete: false,
}));

vi.mock('../../web/src/data/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    mutateApi: mocked.mutateApi,
    getRecoveryJobApi: mocked.getRecoveryJobApi,
  };
});

vi.mock('../../web/src/data/drafts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof DraftsModule>();
  return {
    ...actual,
    loadProposal: async (key: string) => mocked.proposalStorage.get(key),
    saveProposal: async (key: string, proposal: unknown) => {
      mocked.events.push('persist');
      mocked.proposalStorage.set(key, proposal);
    },
    deleteProposal: async (key: string) => {
      mocked.events.push('delete');
      if (mocked.failDelete) throw new Error('storage is unavailable');
      mocked.proposalStorage.delete(key);
    },
  };
});

const epoch = randomUUID();
const operationId = randomUUID();
const metadata = metaDataSchema.parse({
  database_epoch: epoch,
  timezone: 'Europe/Moscow',
  settings_revision: 3,
  contract_version: 1,
  schema_version: 1,
  maintenance: false,
});
const project = projectResourceSchema.parse({
  slug: 'alpha',
  name: 'Альфа',
  description: '',
  emoji: '🗃️',
  priority: 0,
  archived_at: null,
  revision: 2,
  config_revision: 4,
  created_at: '2026-10-22T00:00:00.000Z',
  updated_at: '2026-10-22T00:00:00.000Z',
});

function backupResult(id: string, currentOperation = operationId) {
  return {
    ok: true,
    data: {
      id,
      created_at: '2026-10-22T00:00:00.000Z',
      database_epoch: epoch,
      schema_version: 1,
      checksum: 'a'.repeat(64),
      size_bytes: 100,
      settings_revision: 3,
      projects: [{ project_slug: 'alpha', revision: 2, config_revision: 4 }],
    },
    meta: {
      database_epoch: epoch,
      timezone: 'Europe/Moscow',
      now: '2026-10-22T00:00:00.000Z',
      operation_id: currentOperation,
      audit_ids: [],
    },
  };
}
function job(state: 'queued' | 'running' | 'succeeded' | 'failed') {
  return recoveryJobEnvelopeSchema.parse({
    ok: true,
    data: {
      job_id: randomUUID(),
      operation_id: operationId,
      state,
      started_at: '2026-10-22T00:00:00.000Z',
      finished_at: state === 'queued' || state === 'running' ? null : '2026-10-22T00:00:01.000Z',
      result: null,
      error: null,
    },
    meta: {
      database_epoch: epoch,
      timezone: 'Europe/Moscow',
      now: '2026-10-22T00:00:01.000Z',
      operation_id: operationId,
      audit_ids: [],
    },
  });
}
function state(): {
  state: BackupOperationState;
  values: {
    pending: OperationProposal | undefined;
    busy: boolean;
    error: unknown;
    storageError: string;
    job: ReturnType<typeof job> | undefined;
  };
} {
  const values: {
    pending: OperationProposal | undefined;
    busy: boolean;
    error: unknown;
    storageError: string;
    job: ReturnType<typeof job> | undefined;
  } = {
    pending: undefined,
    busy: false,
    error: undefined,
    storageError: '',
    job: undefined,
  };
  return {
    values,
    state: {
      metadata,
      ready: true,
      pendingRef: { current: undefined },
      sending: { current: false },
      acknowledgedCreate: { current: undefined },
      setPending: (next) => {
        values.pending = typeof next === 'function' ? next(values.pending) : next;
      },
      setBusy: (next) => {
        values.busy = typeof next === 'function' ? next(values.busy) : next;
      },
      setStorageError: (next) => {
        values.storageError = typeof next === 'function' ? next(values.storageError) : next;
      },
      setError: (next) => {
        values.error = typeof next === 'function' ? next(values.error) : next;
      },
      setJob: (next) => {
        values.job = typeof next === 'function' ? next(values.job) : next;
      },
    },
  };
}
function apiError(code: string, retryable = false) {
  return new ApiClientError({ code, message: 'request failed', details: null, retryable });
}
function validation() {
  return backupValidationSchema.parse({
    backup: backupResult(randomUUID()).data,
    compatible: true,
    integrity: 'ok',
    affected_projects: [
      { project_slug: 'alpha', expected_revision: 2, expected_config_revision: 4 },
    ],
  });
}

beforeEach(() => {
  mocked.mutateApi.mockReset();
  mocked.getRecoveryJobApi.mockReset();
  mocked.proposalStorage.clear();
  mocked.events = [];
  mocked.failDelete = false;
  updateConnectivity({ online: true, reconciling: false, maintenance: false, epoch });
});

it('persists the immutable proposal before sending the create request', async () => {
  const fixture = state();
  const result = backupResult(randomUUID());
  mocked.mutateApi.mockImplementation(async () => {
    mocked.events.push('send');
    return result;
  });
  await createBackupOperation(fixture.state, project);
  expect(mocked.events).toEqual(['persist', 'send', 'delete']);
  expect(fixture.values.pending).toBeUndefined();
});

it('retains a lost-ack create proposal and retries the same operation ID explicitly', async () => {
  const fixture = state();
  mocked.mutateApi.mockRejectedValueOnce(apiError('CONNECTION_ERROR'));
  mocked.mutateApi.mockResolvedValueOnce(backupResult(randomUUID()));
  await createBackupOperation(fixture.state, project);
  const pending = fixture.state.pendingRef.current;
  expect(pending).toBeDefined();
  await retryBackupOperation(fixture.state);
  expect(mocked.mutateApi.mock.calls.map(([input]) => input.envelope.operation_id)).toEqual([
    pending?.envelope.operation_id,
    pending?.envelope.operation_id,
  ]);
});

it('clears a newly allocated restore proposal after a definite server rejection', async () => {
  const fixture = state();
  mocked.mutateApi.mockRejectedValueOnce(apiError('CONFIRMATION_REQUIRED'));
  await restoreBackupOperation(fixture.state, project, validation(), '');
  expect(fixture.state.pendingRef.current).toBeUndefined();
  expect(mocked.proposalStorage.size).toBe(0);
});

it('retains a previously uncertain create proposal after a later definite rejection', async () => {
  const fixture = state();
  mocked.mutateApi.mockRejectedValueOnce(apiError('CONNECTION_ERROR'));
  await createBackupOperation(fixture.state, project);
  const original = fixture.state.pendingRef.current;
  mocked.mutateApi.mockRejectedValueOnce(apiError('REVISION_CONFLICT'));
  await retryBackupOperation(fixture.state);
  expect(fixture.state.pendingRef.current).toEqual(original);
});

it('retries an uncertain restore only explicitly with its exact frozen request', async () => {
  const fixture = state();
  mocked.mutateApi.mockRejectedValueOnce(apiError('CONNECTION_ERROR'));
  await restoreBackupOperation(fixture.state, project, validation(), 'restore all projects');
  const original = fixture.state.pendingRef.current;
  expect(original).toBeDefined();
  mocked.mutateApi.mockResolvedValueOnce(job('queued'));
  expect(await retryBackupRestore(fixture.state)).toBeDefined();
  expect(mocked.mutateApi.mock.calls[0]?.[0].envelope).toEqual(original?.envelope);
  expect(mocked.mutateApi.mock.calls[1]?.[0].envelope).toEqual(original?.envelope);
  expect(fixture.state.pendingRef.current).toEqual(original);
});

it('keeps an uncertain restore proposal after a definitive response to explicit retry', async () => {
  const fixture = state();
  mocked.mutateApi.mockRejectedValueOnce(apiError('CONNECTION_ERROR'));
  await restoreBackupOperation(fixture.state, project, validation(), 'restore all projects');
  const original = fixture.state.pendingRef.current;
  mocked.mutateApi.mockRejectedValueOnce(apiError('CONFIRMATION_REQUIRED'));
  await retryBackupRestore(fixture.state);
  expect(fixture.state.pendingRef.current).toEqual(original);
});

it('retries acknowledged create cleanup without sending the mutation again', async () => {
  const fixture = state();
  mocked.mutateApi.mockResolvedValueOnce(backupResult(randomUUID()));
  mocked.failDelete = true;
  await createBackupOperation(fixture.state, project);
  mocked.failDelete = false;
  const callCount = mocked.mutateApi.mock.calls.length;
  expect(fixture.state.pendingRef.current).toBeDefined();
  expect(await retryBackupOperation(fixture.state)).toBeDefined();
  expect(mocked.mutateApi.mock.calls).toHaveLength(callCount);
  expect(fixture.state.pendingRef.current).toBeUndefined();
});

it('keeps restore proposals through nonterminal status and clears them only at terminal status', async () => {
  const fixture = state();
  mocked.mutateApi.mockResolvedValueOnce(job('queued'));
  await restoreBackupOperation(fixture.state, project, validation(), 'restore all projects');
  const proposal = fixture.state.pendingRef.current;
  mocked.getRecoveryJobApi.mockResolvedValueOnce(job('running'));
  await settleBackupRestore(fixture.state);
  expect(fixture.state.pendingRef.current).toEqual(proposal);
  mocked.getRecoveryJobApi.mockResolvedValueOnce(job('succeeded'));
  await settleBackupRestore(fixture.state);
  expect(mocked.getRecoveryJobApi).toHaveBeenCalledTimes(2);
  expect(mocked.mutateApi).toHaveBeenCalledTimes(1);
  expect(fixture.state.pendingRef.current).toBeUndefined();
});

it('does not allocate or persist a proposal while the global write gate is offline', async () => {
  const fixture = state();
  updateConnectivity({ online: false, reconciling: false });
  await createBackupOperation(fixture.state, project);
  expect(mocked.proposalStorage.size).toBe(0);
  expect(mocked.mutateApi).not.toHaveBeenCalled();
});

it('does not send an explicit restore retry while offline', async () => {
  const fixture = state();
  mocked.mutateApi.mockRejectedValueOnce(apiError('CONNECTION_ERROR'));
  await restoreBackupOperation(fixture.state, project, validation(), 'restore all projects');
  const original = fixture.state.pendingRef.current;
  updateConnectivity({ online: false, reconciling: false });
  await retryBackupRestore(fixture.state);
  expect(mocked.mutateApi).toHaveBeenCalledTimes(1);
  expect(fixture.state.pendingRef.current).toEqual(original);
});
