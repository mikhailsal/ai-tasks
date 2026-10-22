import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { advanceCalendar } from '../../src/core/recurrence/calendar-enumeration.js';
import {
  publishGeneration,
  requireRecurring,
  setRecurrenceBehavior,
} from '../../src/core/recurrence/generations.js';
import { processRecurrenceTask, tickRecurrence } from '../../src/core/recurrence/tick.js';
import { tasks } from '../../src/schema/entities.js';
import { recurrenceState } from '../../src/schema/recurrence.js';
import { recurrenceInputSchema } from '../../src/schema/recurrence-input.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';
import {
  occurrenceRows,
  outcomeSnapshot,
  parentRevision,
  seedOccurrence,
  seedOutcomeParent,
  type OutcomeParent,
} from '../fixtures/occurrence-outcomes.js';
import { ordinaryInput, type OrdinaryFixture } from '../fixtures/ordinary-work.js';
const day = 86400000;
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());
function pause(parent: OutcomeParent, now: number) {
  fixture.connection.db.transaction(
    (transaction) => {
      setRecurrenceBehavior(transaction, {
        task: requireRecurring(transaction, parent.slug, parent.id),
        generationId: parent.generation,
        behavior: 'paused',
        now,
      });
      transaction.update(tasks).set({ statusId: 'paused' }).where(eq(tasks.id, parent.id)).run();
    },
    { behavior: 'immediate' },
  );
}
function advance(parent: OutcomeParent, limit = 128) {
  return fixture.connection.db.transaction(
    (transaction) =>
      advanceCalendar(transaction, {
        task: requireRecurring(transaction, parent.slug, parent.id),
        now: fixture.clock.now(),
        limit,
      }),
    { behavior: 'immediate' },
  );
}
function checkpoint(parent: OutcomeParent) {
  return fixture.connection.db
    .select()
    .from(recurrenceState)
    .where(eq(recurrenceState.taskId, parent.id))
    .get();
}
it('public tick retains old occurrence conditions in its miss audit while summary captures current project configuration', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    window: 1234,
    policy: 'carry_forward',
  });
  const original = seedOccurrence(fixture, parent);
  pause(parent, fixture.clock.now());
  fixture.connection.db.transaction(
    (transaction) =>
      publishGeneration(transaction, {
        task: requireRecurring(transaction, 'alpha', parent.id),
        entry: 'paused',
        now: fixture.clock.now(),
        timezone: 'Europe/Berlin',
        input: recurrenceInputSchema.parse({
          first_deadline: new Date(fixture.clock.now() + day).toISOString(),
          schedule: parent.schedule,
          miss_policy: 'record_miss',
          confirmation_window_ms: 0,
        }),
      }),
    { behavior: 'immediate' },
  );
  fixture.clock.set(original.expires_at + 1);
  const result = tickRecurrence(fixture.human, 'alpha', {
    ...ordinaryInput(fixture, {
      tasks: [{ task_id: parent.id, expected_revision: parentRevision(fixture, parent.id) }],
    }),
    expected_settings_revision: 1,
  });
  const audit = z
    .array(z.object({ action: z.string(), entity_id: z.string(), config_snapshot: z.string() }))
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT action,entity_id,config_snapshot FROM audit_records WHERE operation_id=?')
        .all(result.meta.operation_id),
    );
  const miss = audit.find((event) => event.action === 'occurrence.miss');
  const summary = audit.find((event) => event.action === 'recurrence.tick');
  expect(miss?.entity_id).toBe(original.id);
  expect(JSON.parse(miss?.config_snapshot ?? 'null')).toEqual(
    JSON.parse(original.schedule_snapshot),
  );
  expect(JSON.parse(miss?.config_snapshot ?? 'null')).toMatchObject({
    generation_id: parent.generation,
    timezone: 'Europe/Moscow',
    miss_policy: 'carry_forward',
    confirmation_window_ms: 1234,
  });
  expect(JSON.parse(summary?.config_snapshot ?? 'null')).toMatchObject({
    revision: 1,
    ordinary_workflow: expect.any(Object),
  });
  expect(occurrenceRows(fixture, parent.id)).toMatchObject([
    { id: original.id, state: 'debt', missed_at: original.expires_at },
  ]);
});
it('the final budget slot can create the one future anchor without claiming more work on repeated calls', () => {
  const parent = seedOutcomeParent(fixture, { mode: 'calendar' });
  seedOccurrence(fixture, parent, { key: `calendar:${parent.deadline}` });
  const result = advance(parent, 1);
  expect(result).toMatchObject({ processed: 1, hasMore: false });
  expect(result.events.map((event) => event.action)).toEqual(['occurrence.create']);
  expect(occurrenceRows(fixture, parent.id).map((row) => row.deadline)).toEqual([
    parent.deadline,
    parent.deadline + day,
  ]);
  const before = outcomeSnapshot(fixture);
  expect(advance(parent, 1)).toEqual({ events: [], processed: 0, hasMore: false });
  expect(outcomeSnapshot(fixture)).toEqual(before);
  expect(checkpoint(parent)).toMatchObject({
    cursorAnchor: parent.deadline + day,
    nextCandidateAt: parent.deadline + 2 * day,
  });
});
it('a calendar anchor equal to the pause instant is excluded by the closed active interval', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: fixture.clock.now() - 2 * day,
  });
  seedOccurrence(fixture, parent, { key: `calendar:${parent.deadline}` });
  const pauseAt = parent.deadline + day;
  pause(parent, pauseAt);
  expect(advance(parent)).toMatchObject({ processed: 2, hasMore: false });
  expect(occurrenceRows(fixture, parent.id).map((row) => row.deadline)).toEqual([parent.deadline]);
  expect(occurrenceRows(fixture, parent.id).some((row) => row.deadline === pauseAt)).toBe(false);
  expect(checkpoint(parent)).toMatchObject({
    cursorAnchor: fixture.clock.now(),
    nextCandidateAt: fixture.clock.now() + day,
  });
  const before = outcomeSnapshot(fixture);
  expect(advance(parent)).toEqual({ events: [], processed: 0, hasMore: false });
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it('a future row precreated before pause stays an obligation while skipped paused dates create nothing', () => {
  const first = fixture.clock.now() + day;
  const parent = seedOutcomeParent(fixture, { mode: 'calendar', deadline: first, window: 5 * day });
  const original = seedOccurrence(fixture, parent, { key: `calendar:${first}` });
  pause(parent, fixture.clock.now());
  expect(advance(parent)).toEqual({ events: [], processed: 0, hasMore: false });
  fixture.clock.set(first + 2 * day);
  fixture.connection.db.transaction(
    (transaction) =>
      processRecurrenceTask(transaction, {
        task: requireRecurring(transaction, 'alpha', parent.id),
        now: fixture.clock.now(),
      }),
    { behavior: 'immediate' },
  );
  expect(occurrenceRows(fixture, parent.id)).toEqual([original]);
  fixture.clock.set(original.expires_at + 1);
  const result = fixture.connection.db.transaction(
    (transaction) =>
      processRecurrenceTask(transaction, {
        task: requireRecurring(transaction, 'alpha', parent.id),
        now: fixture.clock.now(),
      }),
    { behavior: 'immediate' },
  );
  expect(result.events.map((event) => event.action)).toEqual(['occurrence.miss']);
  expect(occurrenceRows(fixture, parent.id)).toMatchObject([
    { id: original.id, deadline: first, state: 'debt', missed_at: original.expires_at },
  ]);
});
