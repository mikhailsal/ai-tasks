import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { completeOccurrences } from '../../src/core/recurrence/complete.js';
import { formatTimestamp } from '../../src/core/time.js';
import { tasks } from '../../src/schema/entities.js';
import { auditRecords } from '../../src/schema/history.js';
import { recurrenceState, scheduleGenerations } from '../../src/schema/recurrence.js';
import { generationFixture, generationSnapshot } from '../fixtures/recurrence-generations.js';
import {
  assertOutcomeCommit,
  occurrenceRows,
  outcomeInput,
  parentRevision,
  seedOccurrence,
  seedOutcomeParent,
  selection,
  type OutcomeParent,
} from '../fixtures/occurrence-outcomes.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';

let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

function makeHistorical(parent: OutcomeParent) {
  const old = fixture.connection.db
    .select()
    .from(scheduleGenerations)
    .where(eq(scheduleGenerations.id, parent.generation))
    .get();
  if (!old) throw new Error('Missing historical generation');
  const current = fixture.connection.db
    .insert(scheduleGenerations)
    .values({
      ...old,
      id: randomUUID(),
      generationNumber: 2,
      firstDeadline: fixture.clock.now() + 86_400_000,
      timezone: 'Europe/Berlin',
      missPolicy: 'record_miss',
      windowMs: 1_234,
    })
    .returning()
    .get();
  if (!current) throw new Error('Missing replacement generation');
  fixture.connection.db
    .update(scheduleGenerations)
    .set({ successorGenerationId: current.id })
    .where(eq(scheduleGenerations.id, parent.generation))
    .run();
  fixture.connection.db
    .update(recurrenceState)
    .set({
      currentGenerationId: current.id,
      waitingPredecessorId: null,
      cursorAnchor: null,
      nextCandidateAt: current.firstDeadline,
      revision: 2,
    })
    .where(eq(recurrenceState.taskId, parent.id))
    .run();
  return fixture.connection.db
    .select()
    .from(recurrenceState)
    .where(eq(recurrenceState.taskId, parent.id))
    .get();
}

it('historical completion preserves current parent/checkpoint and audit conditions captured before generation replacement', () => {
  const parent = seedOutcomeParent(fixture, { deadline: fixture.clock.now() - 3_600_000 });
  const seed = seedOccurrence(fixture, parent);
  const state = makeHistorical(parent);
  const revision = parentRevision(fixture, parent.id);
  const parentBefore = fixture.connection.db
    .select()
    .from(tasks)
    .where(eq(tasks.id, parent.id))
    .get();
  const result = completeOccurrences(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, selection([seed])),
  );
  const events = assertOutcomeCommit(fixture, result);
  expect(
    fixture.connection.db
      .select({ action: auditRecords.action })
      .from(auditRecords)
      .where(eq(auditRecords.operationId, result.meta.operation_id))
      .all(),
  ).toEqual([{ action: 'occurrence.miss' }, { action: 'occurrence.complete' }]);
  expect(events.every((event) => event.entity_id === seed.id)).toBe(true);
  for (const event of events) {
    expect(JSON.parse(event.config_snapshot ?? 'null')).toEqual(JSON.parse(seed.schedule_snapshot));
  }
  expect(parentRevision(fixture, parent.id)).toBe(revision);
  expect(fixture.connection.db.select().from(tasks).where(eq(tasks.id, parent.id)).get()).toEqual(
    parentBefore,
  );
  expect(
    fixture.connection.db
      .select()
      .from(recurrenceState)
      .where(eq(recurrenceState.taskId, parent.id))
      .get(),
  ).toEqual(state);
  expect(occurrenceRows(fixture, parent.id)).toHaveLength(1);
  expect(occurrenceRows(fixture, parent.id)[0]).toMatchObject({
    state: 'completed_late',
    actual_completed_at: fixture.clock.now(),
    missed_at: seed.expires_at,
  });
});

it('descending elapsed completion times in explicit batch order reject before any writes, including historical generations', () => {
  const parent = seedOutcomeParent(fixture, { deadline: fixture.clock.now() - 10_000 });
  const first = seedOccurrence(fixture, parent);
  const second = seedOccurrence(fixture, parent, { deadline: fixture.clock.now() - 20_000 });
  makeHistorical(parent);
  // A raw storage failure would expose any attempt to write before validating the whole batch.
  fixture.connection.sqlite.exec(
    "CREATE TRIGGER forbid_unvalidated_completion BEFORE UPDATE ON occurrences BEGIN SELECT RAISE(ABORT, 'completion wrote before validation'); END",
  );
  const before = generationSnapshot(fixture);
  const input = outcomeInput(fixture, parent.id, {
    occurrences: [
      {
        id: first.id,
        expected_revision: first.revision,
        actual_completed_at: formatTimestamp(fixture.clock.now() - 1_000),
      },
      {
        id: second.id,
        expected_revision: second.revision,
        actual_completed_at: formatTimestamp(fixture.clock.now() - 2_000),
      },
    ],
  });
  expect(() => completeOccurrences(fixture.human, 'alpha', parent.id, input)).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(generationSnapshot(fixture)).toEqual(before);
});

it('paused completion stores the real predecessor candidate and creates no paused obligation', () => {
  const parent = seedOutcomeParent(fixture, { status: 'paused' });
  const seed = seedOccurrence(fixture, parent);
  const actual = fixture.clock.now() - 300_000;
  completeOccurrences(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, selection([seed], actual)),
  );
  expect(occurrenceRows(fixture, parent.id)).toHaveLength(1);
  expect(
    fixture.connection.db
      .select()
      .from(recurrenceState)
      .where(eq(recurrenceState.taskId, parent.id))
      .get(),
  ).toMatchObject({
    currentGenerationId: parent.generation,
    waitingPredecessorId: seed.id,
    nextCandidateAt: actual + 3_600_000,
  });
});

it('a backdated completion creates and classifies exactly one successor without inventing another actual', () => {
  const parent = seedOutcomeParent(fixture, {
    deadline: fixture.clock.now() - 3 * 3_600_000,
    policy: 'record_miss',
  });
  const seed = seedOccurrence(fixture, parent);
  const actual = fixture.clock.now() - 2 * 3_600_000;
  const input = outcomeInput(fixture, parent.id, selection([seed], actual));
  const result = completeOccurrences(fixture.human, 'alpha', parent.id, input);
  const rows = occurrenceRows(fixture, parent.id);
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.id !== seed.id)).toMatchObject({
    occurrence_key: `after:${seed.id}`,
    deadline: actual + 3_600_000,
    state: 'missed',
    actual_completed_at: null,
    completion_recorded_at: null,
  });
  const committed = generationSnapshot(fixture);
  expect(completeOccurrences(fixture.human, 'alpha', parent.id, input)).toEqual(result);
  expect(generationSnapshot(fixture)).toEqual(committed);
});
