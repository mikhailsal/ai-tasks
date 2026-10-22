import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { mutationSuccessEnvelopeSchema } from '../../src/schema/envelopes.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { migrateConfiguration } from '../../src/core/projects/configuration.js';
import { createContentionWriters, waitForNativeBusy } from '../fixtures/contention-writers.js';
import {
  createOrdinaryFixture,
  initialWork,
  ordinaryInput,
  ordinarySnapshot,
  durableCounts,
  taskShape,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture;
let work: Awaited<ReturnType<typeof initialWork>>;
const pools: Awaited<ReturnType<typeof createContentionWriters>>[] = [];
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  work = await initialWork(fixture);
});
afterEach(async () => {
  if (fixture.connection.sqlite.inTransaction) fixture.connection.sqlite.exec('ROLLBACK');
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
  await fixture.close();
});
function update(
  taskId: string,
  payload: JsonValue,
  options: {
    slug?: string;
    revision?: number;
    configRevision?: number;
    operationId?: string;
  } = {},
) {
  const slug = options.slug ?? 'alpha';
  return {
    operation: 'task.update' as const,
    scope: { project_slug: slug },
    task_id: taskId,
    input: ordinaryInput(fixture, payload, {
      projectSlug: slug,
      revision: options.revision ?? 1,
      ...(options.configRevision === undefined ? {} : { configRevision: options.configRevision }),
      ...(options.operationId ? { operationId: options.operationId } : {}),
    }),
  };
}
async function writers(commands: Parameters<typeof createContentionWriters>[1]) {
  const pool = await createContentionWriters(fixture, commands);
  pools.push(pool);
  return pool;
}
function counts() {
  const value = durableCounts(fixture);
  return { audit: Number(value.audit), receipt: Number(value.receipt) };
}
function task(id: string) {
  return z
    .object({
      id: z.uuid(),
      title: z.string(),
      description: z.string(),
      revision: z.number(),
      config_revision: z.optional(z.number()),
    })
    .parse(fixture.connection.sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(id));
}
function successful(envelope: unknown) {
  return mutationSuccessEnvelopeSchema.parse(envelope);
}
it('recovers a real transient SQLite busy wait after the lock holder releases without losing the write', async () => {
  const command = update(work.task.id, { description: 'Запись после освобождения блокировки' });
  const pool = await writers([command]);
  expect(fixture.connection.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
  const before = counts();
  fixture.connection.sqlite.exec('BEGIN IMMEDIATE');
  pool.release();
  const pid = pool.helpers[0];
  if (!pid) throw new Error('Missing writer helper');
  expect(await waitForNativeBusy(pid)).toMatch(/nanosleep/u);
  expect(counts()).toEqual(before);
  fixture.connection.sqlite.exec('COMMIT');
  const results = await pool.results;
  expect(successful(results[0]?.envelope).data).toMatchObject({
    description: 'Запись после освобождения блокировки',
    revision: 2,
  });
  expect(task(work.task.id)).toMatchObject({
    description: 'Запись после освобождения блокировки',
    revision: 2,
  });
  expect(counts()).toEqual({ audit: before.audit + 1, receipt: before.receipt + 1 });
});
it('exhausts the actual production 5000ms busy handler as DB_CONFLICT with no partial state/audit/receipt', async () => {
  const command = update(work.task.id, { description: 'Не должна сохраниться' });
  const pool = await writers([command]);
  const before = ordinarySnapshot(fixture);
  fixture.connection.sqlite.exec('BEGIN IMMEDIATE');
  const started = performance.now();
  pool.release();
  const pid = pool.helpers[0];
  if (!pid) throw new Error('Missing writer helper');
  expect(await waitForNativeBusy(pid)).toMatch(/nanosleep/u);
  const results = await pool.results;
  const result = results[0];
  if (!result) throw new Error('Missing exhausted writer result');
  expect(result.envelope).toMatchObject({
    ok: false,
    error: { code: 'DB_CONFLICT', retryable: true },
  });
  console.info(
    JSON.stringify({
      event: 'native_busy_timeout',
      configured_ms: 5000,
      elapsed_ms: Math.round(result.elapsedMs),
      code: result.envelope.ok ? 'UNEXPECTED_SUCCESS' : result.envelope.error.code,
    }),
  );
  expect(result.elapsedMs).toBeGreaterThanOrEqual(4900);
  expect(result.elapsedMs).toBeLessThan(8000);
  expect(performance.now() - started).toBeGreaterThanOrEqual(4900);
  expect(ordinarySnapshot(fixture)).toEqual(before);
  fixture.connection.sqlite.exec('ROLLBACK');
});
it('commits independent parent writes from independent connections without lost writes or duplicate history', async () => {
  const commands = [
    update(work.task.id, { description: 'Полная версия Альфы' }),
    update(work.betaTask.id, { description: 'Полная версия Беты' }, { slug: 'beta' }),
  ];
  const pool = await writers(commands);
  expect(new Set(pool.helpers).size).toBe(2);
  expect(new Set(pool.workers).size).toBe(2);
  const before = counts();
  pool.release();
  const results = await pool.results;
  expect(results.map((result) => result.envelope.ok)).toEqual([true, true]);
  expect(task(work.task.id)).toMatchObject({ description: 'Полная версия Альфы', revision: 2 });
  expect(task(work.betaTask.id)).toMatchObject({ description: 'Полная версия Беты', revision: 2 });
  expect(counts()).toEqual({ audit: before.audit + 2, receipt: before.receipt + 2 });
  for (const command of commands)
    expect(
      fixture.connection.sqlite
        .prepare('SELECT count(*) FROM operation_receipts WHERE operation_id=?')
        .pluck()
        .get(command.input.operation_id),
    ).toBe(1);
});
it('replays a simultaneous identical operation before stale parent guards and writes exactly one audit and receipt', async () => {
  const command = update(work.task.id, { description: 'Один неизменяемый запрос' });
  const pool = await writers([command, command]);
  const before = counts();
  pool.release();
  const results = await pool.results;
  const replies = results.map((result) => successful(result.envelope));
  expect(replies[0]).toEqual(replies[1]);
  expect(task(work.task.id)).toMatchObject({
    description: 'Один неизменяемый запрос',
    revision: 2,
  });
  expect(counts()).toEqual({ audit: before.audit + 1, receipt: before.receipt + 1 });
  expect(replies[0]?.meta.audit_ids).toHaveLength(1);
});
it('rejects a simultaneous changed-payload operation ID as IDEMPOTENCY_CONFLICT instead of overwriting its winner', async () => {
  const operationId = randomUUID();
  const commands = [
    update(work.task.id, { description: 'Первая версия' }, { operationId }),
    update(work.task.id, { description: 'Вторая версия' }, { operationId }),
  ];
  const pool = await writers(commands);
  const before = counts();
  pool.release();
  const results = await pool.results;
  const winner = results.find((result) => result.envelope.ok);
  const loser = results.find((result) => !result.envelope.ok);
  if (!winner || !loser) throw new Error('Missing same-operation winner/loser');
  expect(loser.envelope).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
  expect(task(work.task.id).description).toBe(
    taskShape.parse(successful(winner.envelope).data).description,
  );
  expect(task(work.task.id).revision).toBe(2);
  expect(counts()).toEqual({ audit: before.audit + 1, receipt: before.receipt + 1 });
});
it.each(['whole descriptions', 'disjoint fields'])(
  'rejects stale %s from opposing writers without automatic text merge',
  async (mode) => {
    const left = { description: 'Точный **исходник А**\nСохранить целиком.\n' };
    const right =
      mode === 'whole descriptions'
        ? { description: 'Точный исходник Б\n  Другой абзац.\n' }
        : { title: 'Отдельная правка названия' };
    const commands = [update(work.task.id, left), update(work.task.id, right)];
    const original = task(work.task.id);
    const before = counts();
    const pool = await writers(commands);
    pool.release();
    const results = await pool.results;
    const winner = results.find((result) => result.envelope.ok);
    const loser = results.find((result) => !result.envelope.ok);
    if (!winner || !loser) throw new Error('Missing optimistic-concurrency result');
    expect(loser.envelope).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    const winning = winner.workerId === 0 ? left : right;
    expect(task(work.task.id)).toMatchObject({ ...original, ...winning, revision: 2 });
    expect(counts()).toEqual({ audit: before.audit + 1, receipt: before.receipt + 1 });
  },
);
it('rejects a stale configuration token from an already-open process while a fresh-token writer commits', async () => {
  const other = taskShape.parse(
    work.api.createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { kind: 'ordinary', title: 'Старые настройки' }),
    ).data,
  );
  const commands = [
    update(other.id, { description: 'Старый config token' }),
    update(work.task.id, { description: 'Актуальный config token' }, { configRevision: 2 }),
  ];
  const pool = await writers(commands);
  const config = createDefaultProjectConfig();
  config.ordinary_workflow.statuses = config.ordinary_workflow.statuses.map((status) => ({
    ...status,
    label: `Новая ${status.label}`,
  }));
  migrateConfiguration(
    fixture.human,
    'alpha',
    ordinaryInput(
      fixture,
      jsonValueSchema.parse({
        config,
        status_mappings: [],
        priority_mappings: [],
        affected_tasks: [],
      }),
      { revision: 1 },
    ),
  );
  const before = counts();
  const unchanged = task(other.id);
  pool.release();
  const results = await pool.results;
  expect(results[0]?.envelope).toMatchObject({ ok: false, error: { code: 'CONFIG_CONFLICT' } });
  expect(successful(results[1]?.envelope).data).toMatchObject({
    description: 'Актуальный config token',
    config_revision: 2,
    revision: 2,
  });
  expect(task(other.id)).toEqual(unchanged);
  expect(counts()).toEqual({ audit: before.audit + 1, receipt: before.receipt + 1 });
});
