import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  closeRecurrenceInterval,
  publishGeneration,
  requireRecurring,
  setRecurrenceBehavior,
} from '../../src/core/recurrence/generations.js';
import {
  assertRetirable,
  hasOwedCalendarAnchors,
  reconcileBeforeGenerationChange,
} from '../../src/core/recurrence/retirement.js';
import { recurrenceInputSchema } from '../../src/schema/recurrence-input.js';
import { tasks } from '../../src/schema/entities.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';
import {
  occurrenceRows,
  outcomeSnapshot,
  seedOccurrence,
  seedOutcomeParent,
  type OutcomeParent,
} from '../fixtures/occurrence-outcomes.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';

const day = 86400000;
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());
function options(transaction: Parameters<typeof assertRetirable>[0], parent: OutcomeParent) {
  return { task: requireRecurring(transaction, parent.slug, parent.id), now: fixture.clock.now() };
}
function retirable(parent: OutcomeParent) {
  return fixture.connection.db.transaction(
    (transaction) => assertRetirable(transaction, options(transaction, parent)),
    { behavior: 'immediate' },
  );
}
function owed(parent: OutcomeParent) {
  return fixture.connection.db.transaction((transaction) =>
    hasOwedCalendarAnchors(transaction, options(transaction, parent)),
  );
}
function reconcile(parent: OutcomeParent) {
  return fixture.connection.db.transaction(
    (transaction) => reconcileBeforeGenerationChange(transaction, options(transaction, parent)),
    { behavior: 'immediate' },
  );
}

it('an empty occurrence table cannot hide unresolved active-period anchors and pure refusal changes nothing', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: fixture.clock.now() - 3 * day,
  });
  expect(occurrenceRows(fixture, parent.id)).toEqual([]);
  const before = outcomeSnapshot(fixture);
  expect(owed(parent)).toBe(true);
  expect(() => retirable(parent)).toThrow(
    expect.objectContaining({
      code: 'VALIDATION_ERROR',
      details: { reason: 'owed_anchors', action: 'tick', task_id: parent.id },
    }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

it.each(['past-pending', 'future-pending', 'debt'] as const)(
  '%s remains a retirement blocker with actionable identity',
  (kind) => {
    const parent = seedOutcomeParent(fixture, {
      status: 'paused',
      deadline: fixture.clock.now() + (kind === 'future-pending' ? day : -day),
    });
    const row = seedOccurrence(fixture, parent, { state: kind === 'debt' ? 'debt' : 'pending' });
    const before = outcomeSnapshot(fixture);
    expect(() => retirable(parent)).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        details: {
          reason: 'open_occurrences',
          task_id: parent.id,
          occurrence_id: row.id,
          state: row.state,
        },
      }),
    );
    expect(outcomeSnapshot(fixture)).toEqual(before);
  },
);

it('pending work from a historical generation still blocks after the current generation changes', () => {
  const parent = seedOutcomeParent(fixture, { status: 'paused' });
  const row = seedOccurrence(fixture, parent);
  fixture.connection.db.transaction(
    (transaction) =>
      publishGeneration(transaction, {
        task: requireRecurring(transaction, 'alpha', parent.id),
        entry: 'paused',
        now: fixture.clock.now(),
        timezone: 'Europe/Moscow',
        input: recurrenceInputSchema.parse({
          first_deadline: new Date(fixture.clock.now() + day).toISOString(),
          schedule: parent.schedule,
          miss_policy: 'record_miss',
          confirmation_window_ms: 0,
        }),
      }),
    { behavior: 'immediate' },
  );
  expect(() => retirable(parent)).toThrow(
    expect.objectContaining({
      details: expect.objectContaining({ occurrence_id: row.id, state: 'pending' }),
    }),
  );
});

it('missed history does not block retirement or require an invented completion', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    policy: 'record_miss',
    deadline: fixture.clock.now() - day,
  });
  seedOccurrence(fixture, parent, { state: 'missed' });
  const before = outcomeSnapshot(fixture);
  expect(() => retirable(parent)).not.toThrow();
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

it('a draft without any active interval retires without materializing its declared past seed', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    status: 'paused',
    deadline: fixture.clock.now() - 1000 * day,
  });
  fixture.connection.db
    .update(tasks)
    .set({ statusId: 'draft' })
    .where(eq(tasks.id, parent.id))
    .run();
  fixture.connection.sqlite
    .prepare('DELETE FROM recurrence_intervals WHERE task_id=?')
    .run(parent.id);
  const before = outcomeSnapshot(fixture);
  expect(owed(parent)).toBe(false);
  expect(() => retirable(parent)).not.toThrow();
  expect(reconcile(parent)).toEqual({ events: [], processed: 0, hasMore: false });
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

it('the exclusive pause/retirement boundary cannot count as an owed old-generation anchor', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: fixture.clock.now() - day,
  });
  fixture.connection.db.transaction(
    (transaction) =>
      closeRecurrenceInterval(transaction, { taskId: parent.id, now: fixture.clock.now() }),
    { behavior: 'immediate' },
  );
  expect(owed(parent)).toBe(false);
  expect(() => retirable(parent)).not.toThrow();
});

it('bounded reconciliation refusal rolls back the closed interval, new outcomes, and checkpoint together', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: fixture.clock.now() - 200 * day,
  });
  const before = outcomeSnapshot(fixture);
  expect(() => reconcile(parent)).toThrow(
    expect.objectContaining({
      code: 'VALIDATION_ERROR',
      details: { reason: 'owed_anchors', action: 'tick', task_id: parent.id },
    }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

it('successful old-generation reconciliation materializes owed anchors but never adds an extra future period', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    policy: 'record_miss',
    deadline: fixture.clock.now() - 3 * day,
  });
  seedOccurrence(fixture, parent, { state: 'missed', key: `calendar:${parent.deadline}` });
  const result = reconcile(parent);
  expect(result.hasMore).toBe(false);
  expect(result.processed).toBeLessThanOrEqual(128);
  expect(occurrenceRows(fixture, parent.id).map((row) => row.deadline)).toEqual([
    parent.deadline,
    parent.deadline + day,
    parent.deadline + 2 * day,
  ]);
  expect(occurrenceRows(fixture, parent.id).every((row) => row.state === 'missed')).toBe(true);
  expect(owed(parent)).toBe(false);
  expect(() => retirable(parent)).not.toThrow();
  expect(result.events.filter((event) => event.action === 'occurrence.create')).toHaveLength(2);
  expect(result.events.filter((event) => event.action === 'occurrence.miss')).toHaveLength(2);
});

it.each([0, 2])(
  'a long pause after %d unresolved old anchors does not require scanning inactive dates',
  (owedCount) => {
    const first = fixture.clock.now() - 1000 * day;
    const parent = seedOutcomeParent(fixture, {
      mode: 'calendar',
      policy: 'record_miss',
      deadline: first,
    });
    seedOccurrence(fixture, parent, { state: 'missed', key: `calendar:${first}` });
    fixture.connection.db.transaction(
      (transaction) => {
        setRecurrenceBehavior(transaction, {
          task: requireRecurring(transaction, 'alpha', parent.id),
          generationId: parent.generation,
          behavior: 'paused',
          now: first + (owedCount + 1) * day,
        });
        transaction.update(tasks).set({ statusId: 'paused' }).where(eq(tasks.id, parent.id)).run();
      },
      { behavior: 'immediate' },
    );
    expect(owed(parent)).toBe(owedCount > 0);
    const result = reconcile(parent);
    expect(result.hasMore).toBe(false);
    expect(result.processed).toBeLessThanOrEqual(128);
    if (owedCount === 0) expect(result.processed).toBe(0);
    expect(result.events.filter((event) => event.action === 'occurrence.create')).toHaveLength(
      owedCount,
    );
    expect(occurrenceRows(fixture, parent.id).map((row) => row.deadline)).toEqual(
      Array.from({ length: owedCount + 1 }, (_, index) => first + index * day),
    );
    expect(owed(parent)).toBe(false);
    expect(() => retirable(parent)).not.toThrow();
  },
);
