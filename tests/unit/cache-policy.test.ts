/// <reference lib="dom" />
// This test imports browser-owned cache modules; runtime cases remain pure and open no IndexedDB.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query';
import { auditResourceSchema } from '../../src/schema/audit.js';
import { backupInfoSchema } from '../../src/schema/recovery.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { canonicalReadPath, recordRead, snapshotKey } from '../../web/src/data/cache.js';
import { CACHE_GC_TIME, CACHE_MAX_AGE, CACHE_VERSION } from '../../web/src/data/cache-storage.js';
import { successfulQuerySnapshot } from '../../web/src/data/cache-query.js';
import { snapshotMatchesEpoch } from '../../web/src/data/cache-identity.js';
import {
  canMutate,
  connectivitySnapshot,
  updateConnectivity,
} from '../../web/src/data/connectivity.js';
const original = connectivitySnapshot();
const epoch = randomUUID();
const oldEpoch = randomUUID();
afterEach(() => updateConnectivity(original));
function envelope(databaseEpoch = epoch) {
  return successEnvelopeSchema.parse({
    ok: true,
    data: JSON.parse('{"description":"  **source**\\n","__proto__":{"kept":true}}'),
    meta: {
      database_epoch: databaseEpoch,
      timezone: 'Europe/Moscow',
      now: '2026-10-22T00:00:00.123Z',
    },
  });
}
function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
}

describe('offline read snapshot policy', () => {
  it('has no artificial persistence or garbage-collection time limit', () => {
    expect(CACHE_MAX_AGE).toBe(Infinity);
    expect(CACHE_GC_TIME).toBe(CACHE_MAX_AGE);
  });
  it('separates epoch/config/scope/filter identities while canonicalizing query parameter order', () => {
    expect(canonicalReadPath('/tasks?q=hello&project_slug=alpha')).toBe(
      canonicalReadPath('/tasks?project_slug=alpha&q=hello'),
    );
    for (const bad of ['https://other.invalid/tasks', '//other.invalid/tasks', '/tasks#hidden'])
      expect(() => canonicalReadPath(bad)).toThrow();
    const base: Parameters<typeof snapshotKey>[0] = {
      version: CACHE_VERSION,
      schema_version: 1,
      epoch,
      configuration: 'alpha:1',
      path: '/tasks?project_slug=alpha',
      saved_at: 1,
      value: envelope(),
    };
    expect(
      new Set([
        snapshotKey(base),
        snapshotKey({ ...base, epoch: oldEpoch }),
        snapshotKey({ ...base, configuration: 'alpha:2' }),
        snapshotKey({ ...base, path: '/tasks?all_projects=true' }),
        snapshotKey({ ...base, path: '/tasks?project_slug=alpha&q=other' }),
      ]).size,
    ).toBe(5);
  });
  it('retains the last successful data/time after a failed refresh, without persisting an error', () => {
    updateConnectivity({ epoch });
    const client = queryClient();
    client.setQueryData(['detail', 'alpha'], envelope(), { updatedAt: 1 });
    const query = client.getQueryCache().find({ queryKey: ['detail', 'alpha'] });
    if (!query) throw new Error('Expected actual TanStack cached query');
    query.setState({
      status: 'error',
      error: new Error('/private/database.sqlite secret SQL'),
      errorUpdatedAt: Date.now(),
    });
    const saved = successfulQuerySnapshot({
      timestamp: 1,
      buster: '',
      clientState: dehydrate(client, { shouldDehydrateQuery: () => true }),
    });
    expect(saved.clientState.queries).toHaveLength(1);
    expect(saved.clientState.queries[0]?.state).toMatchObject({
      status: 'success',
      error: null,
      dataUpdatedAt: 1,
    });
    expect(JSON.stringify(saved)).not.toContain('/private');
    const restored = queryClient();
    hydrate(restored, saved.clientState);
    expect(restored.getQueryData(['detail', 'alpha'])).toEqual(envelope());
    const data = successEnvelopeSchema.parse(restored.getQueryData(['detail', 'alpha']));
    expect(
      typeof data.data === 'object' && data.data !== null && Object.hasOwn(data.data, '__proto__'),
    ).toBe(true);
    expect(data.meta.now).toBe('2026-10-22T00:00:00.123Z');
    client.clear();
    restored.clear();
  });
  it('never persists paused mutations or mixed/previous-epoch query snapshots', () => {
    updateConnectivity({ epoch });
    const client = queryClient();
    client.setQueryData(['current'], envelope());
    client.setQueryData(['old'], envelope(oldEpoch));
    client.setQueryData(['mixed'], { current: envelope(), previous: envelope(oldEpoch) });
    client.getMutationCache().build(
      client,
      { mutationKey: ['do-not-queue'] },
      {
        context: undefined,
        data: undefined,
        error: null,
        failureCount: 0,
        failureReason: null,
        isPaused: true,
        status: 'pending',
        variables: { secret: 'unsent edit' },
        submittedAt: 1,
      },
    );
    const saved = successfulQuerySnapshot({
      timestamp: 1,
      buster: '',
      clientState: dehydrate(client),
    });
    expect(saved.clientState.mutations).toEqual([]);
    expect(saved.clientState.queries.map((query) => query.queryKey)).toEqual([['current']]);
    expect(snapshotMatchesEpoch({ current: envelope(), previous: envelope(oldEpoch) }, epoch)).toBe(
      false,
    );
    client.clear();
  });
  it('persists current read envelopes containing old-epoch audit, backup and envelope-shaped historical facts unchanged', () => {
    updateConnectivity({ epoch });
    const source = '  **Сохранённый исходник** 👩🏽‍💻\n';
    const historical = {
      ok: true,
      meta: { database_epoch: oldEpoch },
      data: { text: 'Stored JSON, not a fetched response' },
    };
    const audit = auditResourceSchema.parse({
      id: randomUUID(),
      operation_id: randomUUID(),
      project_slug: 'alpha',
      entity_type: 'task',
      entity_id: randomUUID(),
      actor: 'human-web',
      origin: 'web',
      timestamp: '2026-10-01T00:00:00.001Z',
      action: 'task.update',
      changes: [{ field: 'description', before: historical, after: source }],
      config_snapshot: { revision: 1 },
      config_revision: 1,
      confirmation: null,
      database_epoch: oldEpoch,
    });
    const backup = backupInfoSchema.parse({
      id: randomUUID(),
      created_at: '2026-10-02T00:00:00.002Z',
      database_epoch: oldEpoch,
      schema_version: 1,
      checksum: 'a'.repeat(64),
      size_bytes: 1024,
      settings_revision: 1,
      projects: [{ project_slug: 'alpha', revision: 1, config_revision: 1 }],
    });
    const read = successEnvelopeSchema.parse({
      ...envelope(),
      data: { audits: [audit], backups: [backup] },
    });
    const client = queryClient();
    client.setQueryData(['historical-facts'], read, { updatedAt: 1 });
    const saved = successfulQuerySnapshot({
      timestamp: 1,
      buster: '',
      clientState: dehydrate(client),
    });
    expect(saved.clientState.queries).toHaveLength(1);
    expect(saved.clientState.queries[0]?.state.data).toEqual(read);
    expect(saved.clientState.queries[0]?.state.dataUpdatedAt).toBe(1);
    const restored = queryClient();
    hydrate(restored, saved.clientState);
    expect(restored.getQueryData(['historical-facts'])).toEqual(read);
    expect(JSON.stringify(saved)).toContain(oldEpoch);
    expect(JSON.stringify(saved)).toContain('2026-10-01T00:00:00.001Z');
    expect(JSON.stringify(saved)).toContain('2026-10-02T00:00:00.002Z');
    expect(snapshotMatchesEpoch(read, epoch)).toBe(true);
    client.clear();
    restored.clear();
  });
  it('rejects late old resource and metadata responses without changing the established epoch or touching storage', async () => {
    updateConnectivity({ epoch, online: true, reconciling: false });
    expect(await recordRead('/projects/alpha/tasks/old', envelope(oldEpoch), oldEpoch)).toBe(false);
    const metadata = metaEnvelopeSchema.parse({
      ...envelope(oldEpoch),
      data: {
        database_epoch: oldEpoch,
        timezone: 'Europe/Moscow',
        settings_revision: 1,
        contract_version: 1,
        schema_version: 1,
        maintenance: false,
      },
    });
    expect(await recordRead('/meta?all_projects=true', metadata, oldEpoch)).toBe(false);
    expect(connectivitySnapshot().epoch).toBe(epoch);
  });
  it('requires online reconciled metadata, the same epoch and no maintenance before writes', () => {
    updateConnectivity({ epoch, online: true, reconciling: false, maintenance: false });
    expect(canMutate(epoch)).toBe(true);
    expect(canMutate(oldEpoch)).toBe(false);
    for (const blocked of [{ online: false }, { reconciling: true }, { maintenance: true }]) {
      updateConnectivity({ online: true, reconciling: false, maintenance: false, ...blocked });
      expect(canMutate(epoch)).toBe(false);
    }
  });
});
