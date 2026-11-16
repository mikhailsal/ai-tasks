import { afterEach, beforeEach, expect, it } from 'vitest';
import { occurrenceProgress } from '../../src/core/queries/progress.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';
import { readContext, seedDay, type DayState } from '../fixtures/occurrence-days.js';
import { seedOutcomeParent } from '../fixtures/occurrence-outcomes.js';
import { ordinaryInput, type OrdinaryFixture } from '../fixtures/ordinary-work.js';

/** Spec 008 US3: goal progress over a window of days. */
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

function prepared(days: [string, DayState][]) {
  const parent = seedOutcomeParent(fixture, { policy: 'record_miss', window: 6 * 3600000 });
  for (const [day, state] of days) seedDay(fixture, parent, day, state);
  return parent;
}

function progress(id: string, from_day: string, to_day: string) {
  return occurrenceProgress(readContext(fixture), 'alpha', id, { from_day, to_day }).data;
}

it('answers "how many nights out of 7" with the contract example (SC-002)', () => {
  const parent = prepared([
    ['2026-11-01', 'completed'],
    ['2026-11-02', 'completed'],
    ['2026-11-03', 'completed_late'],
    ['2026-11-04', 'completed'],
    ['2026-11-05', 'missed'],
    ['2026-11-06', 'completed'],
    ['2026-11-07', 'completed'],
    ['2026-11-08', 'completed'],
    ['2026-10-31', 'missed'],
  ]);
  expect(progress(parent.id, '2026-11-01', '2026-11-07')).toEqual({
    task_id: parent.id,
    from_day: '2026-11-01',
    to_day: '2026-11-07',
    done: 6,
    decided: 7,
    open: 0,
    breakdown: { completed: 5, completed_late: 1, missed: 1, debt: 0 },
  });
});

it('owed counts as decided and not done; pending is open (edge cases)', () => {
  const parent = prepared([
    ['2026-11-01', 'completed'],
    ['2026-11-02', 'debt'],
    ['2026-11-03', 'pending'],
  ]);
  expect(progress(parent.id, '2026-11-01', '2026-11-03')).toMatchObject({
    done: 1,
    decided: 2,
    open: 1,
    breakdown: { completed: 1, completed_late: 0, missed: 0, debt: 1 },
  });
  expect(progress(parent.id, '2026-12-01', '2026-12-07')).toMatchObject({ done: 0, decided: 0 });
});

it('refuses reversed and over-long windows and ordinary tasks', () => {
  const parent = prepared([]);
  expect(refusal(() => progress(parent.id, '2026-11-07', '2026-11-01'))).toMatchObject({
    code: 'VALIDATION_ERROR',
  });
  expect(refusal(() => progress(parent.id, '2026-01-01', '2027-01-02'))).toMatchObject({
    code: 'VALIDATION_ERROR',
    details: { maximum: 366 },
  });
  expect(refusal(() => progress(parent.id, '2026-02-30', '2026-03-01'))).toMatchObject({
    code: 'VALIDATION_ERROR',
  });
  const ordinary = createTask(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { kind: 'ordinary', title: 'Обычная', emoji: '⚪' }),
  );
  const id = String((ordinary.data as { id: string }).id);
  expect(refusal(() => progress(id, '2026-11-01', '2026-11-07'))).toMatchObject({
    code: 'VALIDATION_ERROR',
    message: expect.stringContaining('recurring'),
  });
});
