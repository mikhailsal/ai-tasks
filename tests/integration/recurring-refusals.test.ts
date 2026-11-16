import { afterEach, beforeEach, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { blockerSchema } from '../../src/schema/diagnostics.js';
import { cancelOccurrences } from '../../src/core/recurrence/cancel.js';
import { requireRecurring } from '../../src/core/recurrence/generations.js';
import { assertRetirable } from '../../src/core/recurrence/retirement.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';
import {
  outcomeInput,
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

function seedMixed(parent: OutcomeParent) {
  const now = fixture.clock.now();
  return {
    future: seedOccurrence(fixture, parent, { deadline: now + day }),
    past: seedOccurrence(fixture, parent, { deadline: now - day }),
    owed: seedOccurrence(fixture, parent, { deadline: now - 2 * day, state: 'debt' }),
  };
}

function cancel(parent: OutcomeParent, rows: { id: string; revision: number }[]) {
  return () =>
    cancelOccurrences(
      fixture.human,
      parent.slug,
      parent.id,
      outcomeInput(fixture, parent.id, {
        occurrences: rows.map((row) => ({ id: row.id, expected_revision: row.revision })),
        reason: 'Проверка отказа',
      }),
    );
}

it('the 11 Nov case: cancelling owed work names completion, not pausing', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() - day,
  });
  const owed = seedOccurrence(fixture, parent, { state: 'debt' });
  const before = outcomeSnapshot(fixture);
  expect(cancel(parent, [owed])).toThrow(
    expect.objectContaining({
      code: 'VALIDATION_ERROR',
      message: 'Owed occurrences cannot be cancelled. Complete them instead',
      details: {
        entity_id: owed.id,
        blockers: [
          expect.objectContaining({
            reason: 'owed',
            count: 1,
            occurrence_ids: [owed.id],
            step: expect.objectContaining({ action: 'complete_occurrence' }),
          }),
        ],
      },
    }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

it('cancelling several occurrences lists every refused row by reason in step order', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() - 2 * day,
  });
  const rows = seedMixed(parent);
  const before = outcomeSnapshot(fixture);
  expect(cancel(parent, [rows.owed, rows.future, rows.past])).toThrow(
    expect.objectContaining({
      message: '2 of 3 occurrences cannot be cancelled: 1 past pending, 1 owed',
      details: expect.objectContaining({
        entity_id: rows.owed.id,
        blockers: [
          expect.objectContaining({ reason: 'past_pending', occurrence_ids: [rows.past.id] }),
          expect.objectContaining({ reason: 'owed', occurrence_ids: [rows.owed.id] }),
        ],
      }),
    }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

it('cancelling under an active parent names the pause step', () => {
  const parent = seedOutcomeParent(fixture, { deadline: fixture.clock.now() + day });
  const future = seedOccurrence(fixture, parent);
  expect(cancel(parent, [future])).toThrow(
    expect.objectContaining({
      message: 'Pause the recurring parent before cancelling work',
      details: {
        blockers: [
          expect.objectContaining({
            reason: 'parent_not_paused',
            count: 0,
            step: expect.objectContaining({
              action: 'pause_parent',
              command: 'recurrence control',
            }),
          }),
        ],
      },
    }),
  );
});

it('retiring an active parent lists pause, cancel future and resolve steps in order', () => {
  const parent = seedOutcomeParent(fixture, { deadline: fixture.clock.now() - 2 * day });
  const rows = seedMixed(parent);
  const retire = () =>
    fixture.connection.db.transaction(
      (transaction) =>
        assertRetirable(transaction, {
          task: requireRecurring(transaction, parent.slug, parent.id),
          now: fixture.clock.now(),
          paused: false,
        }),
      { behavior: 'immediate' },
    );
  expect(retire).toThrow(
    expect.objectContaining({
      details: expect.objectContaining({
        reason: 'open_occurrences',
        occurrence_id: rows.owed.id,
        blockers: [
          expect.objectContaining({ reason: 'parent_not_paused' }),
          expect.objectContaining({ reason: 'future_pending', count: 1 }),
          expect.objectContaining({ reason: 'past_pending', count: 1 }),
          expect.objectContaining({ reason: 'owed', count: 1 }),
        ],
      }),
    }),
  );
});

it('blocker identities are bounded with an omitted count', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() - day,
  });
  const rows = Array.from({ length: 12 }, (_, index) =>
    seedOccurrence(fixture, parent, {
      deadline: fixture.clock.now() - (index + 1) * 1000,
      state: 'debt',
    }),
  );
  expect(cancel(parent, rows)).toThrow(
    expect.objectContaining({
      details: expect.objectContaining({
        blockers: [
          expect.objectContaining({
            reason: 'owed',
            count: 12,
            omitted: 2,
            occurrence_ids: expect.arrayContaining([rows[0]?.id]),
          }),
        ],
      }),
    }),
  );
});

it('blocker details match the published diagnostic shapes', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() - day,
  });
  const owed = seedOccurrence(fixture, parent, { state: 'debt' });
  try {
    cancel(parent, [owed])();
    expect.fail('cancel should be refused');
  } catch (error) {
    const details = Reflect.get(Object(error), 'details') as { blockers: unknown };
    expect(z.array(blockerSchema).safeParse(details.blockers).success).toBe(true);
  }
});
