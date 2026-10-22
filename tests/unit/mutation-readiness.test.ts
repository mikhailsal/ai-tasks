/// <reference lib="dom" />
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mutationEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { recoveryJobEnvelopeSchema } from '../../src/schema/recovery.js';
import { getBuiltinPresets } from '../../src/core/projects/presets.js';
import { ApiClientError, getApi, getRecoveryJobApi, mutateApi } from '../../web/src/data/api.js';
import { recordRead, refreshReadState } from '../../web/src/data/cache.js';
import {
  canMutate,
  connectivitySnapshot,
  markMaintenance,
  updateConnectivity,
} from '../../web/src/data/connectivity.js';
const original = connectivitySnapshot();
const epoch = randomUUID();
const timestamp = '2026-10-22T00:00:00.123Z';
function input() {
  return mutationEnvelopeSchema.parse({
    database_epoch: epoch,
    operation_id: randomUUID(),
    payload: { description: '  **source**\n' },
  });
}
function options() {
  return {
    path: '/projects/alpha/tasks',
    method: 'POST' as const,
    envelope: input(),
    currentEpoch: epoch,
  };
}
function meta(databaseEpoch: string) {
  return {
    ok: true,
    data: {
      database_epoch: databaseEpoch,
      timezone: 'Europe/Moscow',
      settings_revision: 1,
      contract_version: 1,
      schema_version: 1,
      maintenance: false,
    },
    meta: { database_epoch: databaseEpoch, timezone: 'Europe/Moscow', now: timestamp },
  };
}
beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:3000' } });
  updateConnectivity({
    ...original,
    epoch,
    online: true,
    reconciling: false,
    maintenance: false,
    unavailableProjects: [],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  updateConnectivity(original);
});
it.each([
  [{ online: false }, 'OFFLINE'],
  [{ reconciling: true }, 'MAINTENANCE'],
  [{ maintenance: true }, 'MAINTENANCE'],
  [{ epoch: randomUUID() }, 'DATABASE_EPOCH_CONFLICT'],
  [{ unavailableProjects: ['alpha'] }, 'PROJECT_NOT_FOUND'],
] as const)(
  'rejects blocked commands before fetch and marks this attempt definitely unsent: %j',
  async (state, code) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    updateConnectivity(state);
    const command = options();
    const originalBody = JSON.stringify(command);
    await expect(mutateApi(command)).rejects.toMatchObject({ code, definitelyUnsent: true });
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(command)).toBe(originalBody);
  },
);
it('keeps server maintenance distinct from definitely-unsent local rejection', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'MAINTENANCE', message: 'Maintenance', details: null, retryable: true },
        }),
        { status: 503 },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  await expect(mutateApi(options())).rejects.toMatchObject({
    code: 'MAINTENANCE',
    definitelyUnsent: false,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(canMutate(epoch)).toBe(false);
  expect(connectivitySnapshot()).toMatchObject({ maintenance: true, reconciling: true });
});
it('keeps an existing validated read visible during maintenance without changing its saved time', async () => {
  const path = '/projects/alpha/tasks/maintenance-copy';
  const saved = successEnvelopeSchema.parse({
    ok: true,
    data: {
      description: '  **saved source**\n',
      rendered_html: '<p><strong>saved source</strong></p>',
    },
    meta: { database_epoch: epoch, timezone: 'Europe/Moscow', now: timestamp },
  });
  expect(await recordRead(path, saved, epoch)).toBe(true);
  const savedAt = connectivitySnapshot().lastSuccessfulAt;
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'MAINTENANCE', message: 'Maintenance', details: null, retryable: true },
        }),
        { status: 503 },
      ),
  );
  expect(await getApi(path, successEnvelopeSchema)).toEqual(saved);
  expect(connectivitySnapshot()).toMatchObject({
    maintenance: true,
    reconciling: true,
    lastSuccessfulAt: savedAt,
  });
  expect(canMutate(epoch)).toBe(false);
});
it('does not reinterpret an ordinary lost-response retry as locally unsent', () => {
  const error = new ApiClientError({
    code: 'CONNECTION_ERROR',
    message: 'Unknown outcome',
    details: null,
    retryable: false,
  });
  expect(error.definitelyUnsent).toBe(false);
});
it.each(['job', 'operation'] as const)(
  'reads an old-epoch %s receipt through maintenance without caching or changing authoritative state',
  async (lookup) => {
    const operation = randomUUID();
    const job = randomUUID();
    const historical = randomUUID();
    const envelope = recoveryJobEnvelopeSchema.parse({
      ok: true,
      meta: { database_epoch: historical, timezone: 'Europe/Moscow', now: timestamp },
      data: {
        job_id: job,
        operation_id: operation,
        state: 'queued',
        started_at: timestamp,
        finished_at: null,
        result: null,
        error: null,
      },
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify(envelope), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    markMaintenance(true);
    const before = connectivitySnapshot();
    expect(
      await getRecoveryJobApi(lookup === 'job' ? { jobId: job } : { operationId: operation }),
    ).toEqual(envelope);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      lookup === 'job'
        ? `http://127.0.0.1:3000/api/v1/backups/jobs/${job}?all_projects=true`
        : `http://127.0.0.1:3000/api/v1/backups/jobs?all_projects=true&operation_id=${operation}`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(connectivitySnapshot()).toBe(before);
  },
);
it('requires exactly one validated recovery lookup before sending any request', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const query of [
    {},
    { jobId: randomUUID(), operationId: randomUUID() },
    { jobId: 'not-a-uuid' },
  ])
    await expect(getRecoveryJobApi(query)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      definitelyUnsent: true,
    });
  expect(fetcher).not.toHaveBeenCalled();
});
it('refreshes loaded configuration across epoch cache clearing, while missing restored scopes remain explicitly unavailable', async () => {
  const nextEpoch = randomUUID();
  const config = getBuiltinPresets();
  const configValue = {
    ok: true,
    meta: { database_epoch: epoch, timezone: 'Europe/Moscow', now: timestamp },
    data: {
      revision: 1,
      priority_model: config.priority_models[0],
      ordinary_workflow: config.ordinary_workflow,
      recurring_workflow: config.recurring_workflow,
    },
  };
  expect(await recordRead('/projects/alpha/config', configValue, epoch)).toBe(true);
  const requests: string[] = [];
  let absent = false;
  vi.stubGlobal('fetch', async (path: string) => {
    requests.push(path);
    if (path.endsWith('/meta?all_projects=true'))
      return new Response(JSON.stringify(meta(nextEpoch)), { status: 200 });
    if (absent)
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Missing project',
            details: null,
            retryable: false,
          },
        }),
        { status: 404 },
      );
    return new Response(
      JSON.stringify({ ...configValue, meta: { ...configValue.meta, database_epoch: nextEpoch } }),
      { status: 200 },
    );
  });
  markMaintenance(true);
  await refreshReadState();
  expect(requests).toContain('/api/v1/projects/alpha/config');
  expect(canMutate(nextEpoch, 'alpha')).toBe(true);
  expect(connectivitySnapshot().maintenance).toBe(false);
  absent = true;
  await refreshReadState();
  expect(canMutate(nextEpoch, 'alpha')).toBe(false);
  expect(canMutate(nextEpoch, 'beta')).toBe(true);
  expect(connectivitySnapshot().unavailableProjects).toEqual(['alpha']);
  await refreshReadState();
  expect(connectivitySnapshot().unavailableProjects).toEqual(['alpha']);
});
