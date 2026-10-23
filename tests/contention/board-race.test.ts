import { afterEach, beforeEach, expect, it } from 'vitest';
import type { HelperCommand } from '../../src/api/helper-protocol.js';
import { mutationSuccessEnvelopeSchema } from '../../src/schema/envelopes.js';
import { boardWork, boardColumn, boardInput, boardSnapshot } from '../fixtures/board.js';
import { createContentionWriters, waitForNativeBusy } from '../fixtures/contention-writers.js';
import {
  createOrdinaryFixture,
  durableCounts,
  taskShape,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture;
let work: Awaited<ReturnType<typeof boardWork>>;
const pools: Awaited<ReturnType<typeof createContentionWriters>>[] = [];
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  work = await boardWork(fixture);
});
afterEach(async () => {
  if (fixture.connection.sqlite.inTransaction) fixture.connection.sqlite.exec('ROLLBACK');
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
  await fixture.close();
});
function move(id: string, to = 'idea', before: string | null = null): HelperCommand {
  return {
    operation: 'task.position',
    scope: { project_slug: 'alpha' },
    task_id: id,
    input: boardInput(fixture, id, to, before),
  };
}
async function writers(commands: HelperCommand[]) {
  const pool = await createContentionWriters(fixture, commands);
  pools.push(pool);
  return pool;
}
it('serializes independent process column moves with exactly one optimistic winner and no partial order', async () => {
  const revision = boardColumn(fixture).data.order_revision;
  const before = durableCounts(fixture);
  const pool = await writers([move(work.task.id, 'planning'), move(work.second.id, 'planning')]);
  expect(new Set(pool.helpers).size).toBe(2);
  expect(new Set(pool.workers).size).toBe(2);
  pool.release();
  const results = await pool.results;
  const winner = results.find((result) => result.envelope.ok);
  const loser = results.find((result) => !result.envelope.ok);
  if (!winner || !loser) throw new Error('Missing board race outcomes');
  expect(loser.envelope).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  const saved = taskShape.parse(mutationSuccessEnvelopeSchema.parse(winner.envelope).data);
  expect(boardColumn(fixture, 'planning').data.items).toMatchObject([saved]);
  expect(boardColumn(fixture).data.items).toHaveLength(2);
  expect(boardColumn(fixture).data.order_revision).toBe(revision + 1);
  expect(durableCounts(fixture)).toEqual({
    audit: Number(before.audit) + 1,
    receipt: Number(before.receipt) + 1,
  });
});
it('replays simultaneous identical position commands exactly once across independent processes', async () => {
  const command = move(work.third.id, 'idea', work.task.id);
  const before = durableCounts(fixture);
  const pool = await writers([command, command]);
  pool.release();
  const results = await pool.results;
  expect(results[0]?.envelope).toEqual(results[1]?.envelope);
  expect(results[0]?.envelope.ok).toBe(true);
  expect(boardColumn(fixture).data.items.map((row) => row.id)).toEqual([
    work.third.id,
    work.task.id,
    work.second.id,
  ]);
  expect(durableCounts(fixture)).toEqual({
    audit: Number(before.audit) + 1,
    receipt: Number(before.receipt) + 1,
  });
});
it('completes a real transient native write lock without losing the guarded board move', async () => {
  const pool = await writers([move(work.third.id, 'idea', work.task.id)]);
  fixture.connection.sqlite.exec('BEGIN IMMEDIATE');
  pool.release();
  const pid = pool.helpers[0];
  if (!pid) throw new Error('Missing writer');
  await waitForNativeBusy(pid);
  fixture.connection.sqlite.exec('COMMIT');
  const results = await pool.results;
  expect(results[0]?.envelope.ok).toBe(true);
  expect(boardColumn(fixture).data.items.map((row) => row.id)).toEqual([
    work.third.id,
    work.task.id,
    work.second.id,
  ]);
});
it('returns controlled DB_CONFLICT after the production lock wait without task/order/audit/receipt changes', async () => {
  const pool = await writers([move(work.task.id, 'planning')]);
  const before = boardSnapshot(fixture);
  fixture.connection.sqlite.exec('BEGIN IMMEDIATE');
  pool.release();
  const pid = pool.helpers[0];
  if (!pid) throw new Error('Missing writer');
  await waitForNativeBusy(pid);
  const results = await pool.results;
  expect(results[0]?.envelope).toMatchObject({
    ok: false,
    error: { code: 'DB_CONFLICT', retryable: true },
  });
  expect(results[0]?.elapsedMs).toBeGreaterThanOrEqual(4900);
  expect(boardSnapshot(fixture)).toEqual(before);
  fixture.connection.sqlite.exec('ROLLBACK');
});
