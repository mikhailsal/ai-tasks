import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { expireOccurrence, expireTaskOccurrences } from '../../src/core/recurrence/expire.js';
import { materializeOccurrence } from '../../src/core/recurrence/snapshots.js';
import { formatTimestamp } from '../../src/core/time.js';
import { tasks } from '../../src/schema/entities.js';
import { occurrences, scheduleGenerations } from '../../src/schema/recurrence.js';
import { seedOccurrence, seedOutcomeParent } from '../fixtures/occurrence-outcomes.js';
import { generationFixture, generationSnapshot } from '../fixtures/recurrence-generations.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';

let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());
function stored(id: string) {
  const row = fixture.connection.db.select().from(occurrences).where(eq(occurrences.id, id)).get();
  if (!row) throw new Error('Missing real occurrence');
  return row;
}
function batch(taskId: string, limit?: number) {
  return fixture.connection.db.transaction(
    (transaction) =>
      expireTaskOccurrences(transaction, {
        taskId,
        now: fixture.clock.now(),
        ...(limit === undefined ? {} : { limit }),
      }),
    { behavior: 'immediate' },
  );
}

it.each(['carry_forward', 'record_miss'] as const)(
  'expiry under %s is strict, records the logical boundary, and deduplicates stale row references',
  (policy) => {
    const parent = seedOutcomeParent(fixture, { mode: 'calendar', policy, window: 1_234 });
    const seed = seedOccurrence(fixture, parent);
    const row = stored(seed.id);
    fixture.clock.set(row.expiresAt);
    const before = generationSnapshot(fixture);
    const atEndpoint = fixture.connection.db.transaction(
      (transaction) => expireOccurrence(transaction, { row, now: fixture.clock.now() }),
      { behavior: 'immediate' },
    );
    expect(atEndpoint).toEqual({ row, events: [] });
    expect(generationSnapshot(fixture)).toEqual(before);
    fixture.clock.advanceBy(1);
    const result = fixture.connection.db.transaction(
      (transaction) => {
        const first = expireOccurrence(transaction, { row, now: fixture.clock.now() });
        const repeated = expireOccurrence(transaction, { row, now: fixture.clock.now() });
        expect(repeated).toEqual({ row: first.row, events: [] });
        return first;
      },
      { behavior: 'immediate' },
    );
    expect(result.row).toEqual({
      ...row,
      state: policy === 'carry_forward' ? 'debt' : 'missed',
      missedAt: row.expiresAt,
      revision: row.revision + 1,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      action: 'occurrence.miss',
      entity_id: row.id,
      config_snapshot: row.scheduleSnapshot,
    });
    expect(result.events[0]?.changes).toContainEqual({
      field: 'missed_at',
      before: null,
      after: formatTimestamp(row.expiresAt),
    });
    const settled = generationSnapshot(fixture);
    fixture.clock.advanceBy(1_000_000);
    expect(batch(parent.id)).toEqual({ events: [], processed: 0, hasMore: false });
    expect(generationSnapshot(fixture)).toEqual(settled);
  },
);

it.each([0, 2_592_000_000])(
  'captured window %d remains pending exactly at its inclusive endpoint',
  (window) => {
    const parent = seedOutcomeParent(fixture, { mode: 'calendar', window });
    const seed = seedOccurrence(fixture, parent);
    fixture.clock.set(seed.expires_at);
    expect(batch(parent.id)).toEqual({ events: [], processed: 0, hasMore: false });
    expect(stored(seed.id).state).toBe('pending');
    fixture.clock.advanceBy(1);
    expect(batch(parent.id)).toMatchObject({ processed: 1, hasMore: false });
    expect(stored(seed.id)).toMatchObject({ state: 'debt', missedAt: seed.expires_at });
  },
);

it('bounded batches expire oldest due rows first and resume without duplicated events', () => {
  const parent = seedOutcomeParent(fixture, { mode: 'calendar' });
  const newest = seedOccurrence(fixture, parent, { deadline: fixture.clock.now() - 1_000 });
  const oldest = seedOccurrence(fixture, parent, { deadline: fixture.clock.now() - 3_000 });
  const middle = seedOccurrence(fixture, parent, { deadline: fixture.clock.now() - 2_000 });
  const future = seedOccurrence(fixture, parent, { deadline: fixture.clock.now() + 1 });
  const first = batch(parent.id, 2);
  expect(first).toMatchObject({ processed: 2, hasMore: true });
  expect(first.events.map((event) => event.entity_id)).toEqual([oldest.id, middle.id]);
  expect(stored(newest.id).state).toBe('pending');
  const second = batch(parent.id, 2);
  expect(second).toMatchObject({ processed: 1, hasMore: false });
  expect(second.events.map((event) => event.entity_id)).toEqual([newest.id]);
  expect(stored(future.id).state).toBe('pending');
  expect(batch(parent.id, 2)).toEqual({ events: [], processed: 0, hasMore: false });
});

it('default batch bounds 129 due rows to 128 and reports the remaining work', () => {
  const parent = seedOutcomeParent(fixture, { mode: 'calendar' });
  for (let index = 0; index < 129; index++)
    seedOccurrence(fixture, parent, { deadline: fixture.clock.now() - index - 1 });
  const first = batch(parent.id);
  expect(first).toMatchObject({ processed: 128, hasMore: true });
  expect(first.events).toHaveLength(128);
  expect(batch(parent.id)).toMatchObject({ processed: 1, hasMore: false });
});

it('paused parent expiry includes old and current generations, preserving both frozen snapshots and checkpoint', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    status: 'paused',
    deadline: fixture.clock.now() - 3_000,
  });
  const old = seedOccurrence(fixture, parent);
  const task = fixture.connection.db.select().from(tasks).where(eq(tasks.id, parent.id)).get();
  const prior = fixture.connection.db
    .select()
    .from(scheduleGenerations)
    .where(eq(scheduleGenerations.id, parent.generation))
    .get();
  if (!task || !prior) throw new Error('Missing persisted paused parent');
  const current = fixture.connection.db
    .insert(scheduleGenerations)
    .values({
      ...prior,
      id: randomUUID(),
      generationNumber: 2,
      firstDeadline: fixture.clock.now() - 2_000,
      missPolicy: 'record_miss',
    })
    .returning()
    .get();
  if (!current) throw new Error('Missing current generation');
  fixture.connection.sqlite
    .prepare('UPDATE recurrence_state SET current_generation_id=? WHERE task_id=?')
    .run(current.id, parent.id);
  const next = fixture.connection.db.transaction(
    (transaction) =>
      materializeOccurrence(transaction, {
        task,
        generation: current,
        deadline: current.firstDeadline,
        key: 'calendar:new',
        now: fixture.clock.now(),
      }),
    { behavior: 'immediate' },
  ).row;
  const oldRow = stored(old.id);
  const beforeState = fixture.connection.sqlite
    .prepare('SELECT * FROM recurrence_state WHERE task_id=?')
    .get(parent.id);
  expect(batch(parent.id)).toMatchObject({ processed: 2, hasMore: false });
  expect(stored(old.id)).toEqual({
    ...oldRow,
    state: 'debt',
    missedAt: oldRow.expiresAt,
    revision: 2,
  });
  expect(stored(next.id)).toEqual({
    ...next,
    state: 'missed',
    missedAt: next.expiresAt,
    revision: 2,
  });
  expect(
    fixture.connection.sqlite
      .prepare('SELECT * FROM recurrence_state WHERE task_id=?')
      .get(parent.id),
  ).toEqual(beforeState);
  expect(fixture.connection.db.select().from(tasks).where(eq(tasks.id, parent.id)).get()).toEqual(
    task,
  );
});

it('a stale pending reference cannot replace a completed outcome with a miss', () => {
  const parent = seedOutcomeParent(fixture, { mode: 'calendar' });
  const seed = seedOccurrence(fixture, parent);
  const row = stored(seed.id);
  fixture.connection.db
    .update(occurrences)
    .set({
      state: 'completed',
      actualCompletedAt: row.deadline,
      completionRecordedAt: row.deadline,
      revision: 2,
    })
    .where(eq(occurrences.id, row.id))
    .run();
  fixture.clock.set(row.expiresAt + 1);
  const before = generationSnapshot(fixture);
  const result = fixture.connection.db.transaction(
    (transaction) => expireOccurrence(transaction, { row, now: fixture.clock.now() }),
    { behavior: 'immediate' },
  );
  expect(result.row.state).toBe('completed');
  expect(result.events).toEqual([]);
  expect(generationSnapshot(fixture)).toEqual(before);
});

it('caller failure rolls back every expired row in the same transaction', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: fixture.clock.now() - 1,
  });
  seedOccurrence(fixture, parent);
  const before = generationSnapshot(fixture);
  expect(() =>
    fixture.connection.db.transaction(
      (transaction) => {
        expireTaskOccurrences(transaction, { taskId: parent.id, now: fixture.clock.now() });
        throw new Error('failure after expiry');
      },
      { behavior: 'immediate' },
    ),
  ).toThrow('failure after expiry');
  expect(generationSnapshot(fixture)).toEqual(before);
});

it.each([0, -1, 129, 1.5, Number.NaN])(
  'invalid batch limit %d rejects before any write',
  (limit) => {
    const parent = seedOutcomeParent(fixture, {
      mode: 'calendar',
      deadline: fixture.clock.now() - 1,
    });
    seedOccurrence(fixture, parent);
    const before = generationSnapshot(fixture);
    expect(() => batch(parent.id, limit)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(generationSnapshot(fixture)).toEqual(before);
  },
);
