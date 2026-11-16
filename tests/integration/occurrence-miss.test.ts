import { afterEach, beforeEach, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { archiveTask } from '../../src/core/tasks/commands.js';
import { completeOccurrences } from '../../src/core/recurrence/complete.js';
import { expireTaskOccurrences } from '../../src/core/recurrence/expire.js';
import { missOccurrences } from '../../src/core/recurrence/miss.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';
import {
  outcomeInput,
  seedOccurrence,
  seedOutcomeParent,
  type OutcomeParent,
} from '../fixtures/occurrence-outcomes.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';

/** Spec 007: misses with reasons, notes on completions, closing owed work. */
const day = 86400000;
const hour = 3600000;
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

const rowSchema = z.object({
  state: z.string(),
  revision: z.number(),
  missed_at: z.nullable(z.number()),
  miss_reason: z.nullable(z.string()),
  miss_reason_recorded_at: z.nullable(z.number()),
  completion_note: z.nullable(z.string()),
});
function row(id: string) {
  return rowSchema.parse(
    fixture.connection.sqlite.prepare('SELECT * FROM occurrences WHERE id = ?').get(id),
  );
}
function selection(ids: string[]) {
  return ids.map((id) => ({ id, expected_revision: row(id).revision }));
}
function miss(parent: OutcomeParent, ids: string[], reason?: string) {
  return missOccurrences(
    fixture.human,
    parent.slug,
    parent.id,
    outcomeInput(fixture, parent.id, {
      occurrences: selection(ids),
      ...(reason === undefined ? {} : { reason }),
    }),
  );
}
function complete(parent: OutcomeParent, id: string, extra: Record<string, string> = {}) {
  return completeOccurrences(
    fixture.human,
    parent.slug,
    parent.id,
    outcomeInput(fixture, parent.id, { occurrences: [{ ...selection([id])[0], ...extra }] }),
  );
}
function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}
function openWindow(policy: 'carry_forward' | 'record_miss') {
  const parent = seedOutcomeParent(fixture, { policy, window: 6 * hour });
  const now = fixture.clock.now();
  return { parent, occurrence: seedOccurrence(fixture, parent, { deadline: now + hour }) };
}

it('records a miss with a reason while the window is open; expiry later changes nothing (US1-1/2)', () => {
  const { parent, occurrence } = openWindow('record_miss');
  miss(parent, [occurrence.id], 'он сказал нет');
  const recorded = row(occurrence.id);
  expect(recorded).toMatchObject({
    state: 'missed',
    missed_at: fixture.clock.now(),
    miss_reason: 'он сказал нет',
    miss_reason_recorded_at: fixture.clock.now(),
  });
  fixture.clock.advanceBy(2 * day);
  fixture.connection.db.transaction((transaction) =>
    expireTaskOccurrences(transaction, { taskId: parent.id, now: fixture.clock.now() }),
  );
  expect(row(occurrence.id)).toEqual(recorded);
});

it('a reason is optional on record-miss work and can be added once later (US1-3/5)', () => {
  const { parent, occurrence } = openWindow('record_miss');
  miss(parent, [occurrence.id]);
  expect(row(occurrence.id)).toMatchObject({ state: 'missed', miss_reason: null });
  miss(parent, [occurrence.id], 'забыл');
  expect(row(occurrence.id)).toMatchObject({ state: 'missed', miss_reason: 'забыл' });
  expect(refusal(() => miss(parent, [occurrence.id], 'другая'))).toMatchObject({
    code: 'VALIDATION_ERROR',
    details: { state: 'missed', blockers: [expect.objectContaining({ reason: 'reason_exists' })] },
  });
});

it('carry-forward work and owed work need a reason; owed keeps its original miss time (FR-003)', () => {
  const { parent, occurrence } = openWindow('carry_forward');
  expect(refusal(() => miss(parent, [occurrence.id]))).toMatchObject({
    details: { blockers: [expect.objectContaining({ reason: 'reason_required' })] },
  });
  const owed = seedOccurrence(fixture, parent, {
    deadline: fixture.clock.now() - day,
    state: 'debt',
  });
  const missedAt = row(owed.id).missed_at;
  expect(refusal(() => miss(parent, [owed.id]))).toMatchObject({
    message: expect.stringContaining('reason required'),
  });
  miss(parent, [owed.id], 'не будет отработано');
  expect(row(owed.id)).toMatchObject({ state: 'missed', missed_at: missedAt });
  fixture.clock.advanceBy(3 * day);
  fixture.connection.db.transaction((transaction) =>
    expireTaskOccurrences(transaction, { taskId: parent.id, now: fixture.clock.now() }),
  );
  expect(row(owed.id).state).toBe('missed');
});

it('a pending row past its window with a stopped worker expires first (finding E1)', () => {
  const parent = seedOutcomeParent(fixture, { policy: 'record_miss', window: hour });
  const late = seedOccurrence(fixture, parent, { deadline: fixture.clock.now() - day });
  miss(parent, [late.id]);
  expect(row(late.id)).toMatchObject({
    state: 'missed',
    missed_at: fixture.clock.now() - day + hour,
  });
});

it('refuses completed and cancelled rows with the state and the next step (FR-007)', () => {
  const { parent, occurrence } = openWindow('record_miss');
  complete(parent, occurrence.id);
  expect(refusal(() => miss(parent, [occurrence.id], 'поздно'))).toMatchObject({
    message: expect.stringContaining('The occurrence is completed'),
    details: {
      state: 'completed',
      blockers: [expect.objectContaining({ reason: 'already_completed' })],
    },
  });
});

it('a note is stored with the completion; without one the resource has no note key (US2, SC-003)', () => {
  const { parent, occurrence } = openWindow('record_miss');
  const result = complete(parent, occurrence.id, { note: 'время примерное' });
  expect(row(occurrence.id).completion_note).toBe('время примерное');
  expect(JSON.stringify(result.data)).toContain('"completion_note":"время примерное"');
  const second = seedOccurrence(fixture, parent, { deadline: fixture.clock.now() + 2 * hour });
  expect(JSON.stringify(complete(parent, second.id).data)).not.toContain('completion_note');
  expect(
    refusal(() => complete(parent, seedOccurrence(fixture, parent).id, { note: '   ' })),
  ).toMatchObject({
    code: 'VALIDATION_ERROR',
  });
});

it('a missed row completed later keeps its reason next to the note (FR-006)', () => {
  const { parent, occurrence } = openWindow('record_miss');
  miss(parent, [occurrence.id], 'сказал нет');
  complete(parent, occurrence.id, { note: 'всё-таки сделал' });
  expect(row(occurrence.id)).toMatchObject({
    state: 'completed_late',
    miss_reason: 'сказал нет',
    completion_note: 'всё-таки сделал',
  });
});

it('the 11 Nov case: a retired schedule with old owed work archives with no completion (SC-004)', () => {
  const parent = seedOutcomeParent(fixture, { status: 'paused' });
  const owed = seedOccurrence(fixture, parent, {
    deadline: fixture.clock.now() - 2 * day,
    state: 'debt',
  });
  miss(parent, [owed.id], 'привычка отменена');
  archiveTask(fixture.human, parent.slug, parent.id, outcomeInput(fixture, parent.id, {}));
  const states = fixture.connection.sqlite
    .prepare('SELECT state FROM occurrences WHERE task_id = ?')
    .pluck()
    .all(parent.id);
  expect(states).toEqual(['missed']);
});
