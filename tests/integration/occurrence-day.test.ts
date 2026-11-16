import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { updateProject } from '../../src/core/projects/commands.js';
import { getProject } from '../../src/core/queries/projects.js';
import { listOccurrences } from '../../src/core/queries/recurrence.js';
import { occurrenceDay } from '../../src/core/recurrence/day.js';
import { readContext, seedDay } from '../fixtures/occurrence-days.js';
import { seedOutcomeParent } from '../fixtures/occurrence-outcomes.js';
import {
  control,
  createRecurring,
  lifecycleFixture,
  projectEnvelope,
} from '../fixtures/recurrence-lifecycle.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';

/** Spec 008 US1: every occurrence belongs to a day under its project's rule. */
const day = 86400000;
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await lifecycleFixture();
  fixture.clock.set(Date.parse('2026-11-10T08:00:00.000Z'));
});
afterEach(() => fixture.close());

const stored = z.object({ deadline: z.number(), occurrence_day: z.string(), timezone: z.string() });
function storedDays(taskId: string) {
  return z.array(stored).parse(
    fixture.connection.sqlite
      .prepare(
        `SELECT o.deadline, o.occurrence_day, g.timezone FROM occurrences o
         JOIN schedule_generations g ON g.id = o.generation_id WHERE o.task_id = ? ORDER BY o.deadline`,
      )
      .all(taskId),
  );
}
function setDayStart(hour: number) {
  updateProject(fixture.human, 'alpha', projectEnvelope(fixture, { day_start_hour: hour }));
}
function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}
function previousDay(text: string) {
  return new Date(Date.parse(`${text}T00:00:00.000Z`) - day).toISOString().slice(0, 10);
}

it('materialization stores the day under the project rule; a rule change keeps it (FR-001..003)', async () => {
  setDayStart(14);
  expect(getProject(readContext(fixture), 'alpha').data).toMatchObject({ day_start_hour: 14 });
  const id = createRecurring(fixture, fixture.clock.now() + day);
  await control(fixture, id, 'active');
  const [first] = storedDays(id);
  if (!first) throw new Error('Expected an occurrence');
  // The schedule fires at 13:00 local, before the 14:00 start: it belongs to the previous day.
  expect(first.occurrence_day).toBe(previousDay(occurrenceDay(first.deadline, first.timezone)));
  setDayStart(0);
  expect(storedDays(id)[0]?.occurrence_day).toBe(first.occurrence_day);
  expect(getProject(readContext(fixture), 'alpha').data).not.toHaveProperty('day_start_hour');
  const listed = listOccurrences(readContext(fixture), 'alpha', id, {}).data.items[0];
  expect(listed?.occurrence_day).toBe(first.occurrence_day);
});

it('refuses a day start outside 0..23', () => {
  expect(refusal(() => setDayStart(24))).toMatchObject({ code: 'VALIDATION_ERROR' });
});

it('filters occurrences by one day or an inclusive window (FR-002)', () => {
  const parent = seedOutcomeParent(fixture, { policy: 'record_miss', window: 6 * 3600000 });
  for (const text of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'])
    seedDay(fixture, parent, text, 'pending');
  const days = (input: Record<string, string>) =>
    listOccurrences(readContext(fixture), 'alpha', parent.id, input).data.items.map(
      (item) => item.occurrence_day,
    );
  expect(days({ day: '2026-11-02' })).toEqual(['2026-11-02']);
  expect(days({ from_day: '2026-11-02', to_day: '2026-11-03' }).sort()).toEqual([
    '2026-11-02',
    '2026-11-03',
  ]);
  for (const input of [
    { day: '2026-11-02', from_day: '2026-11-01', to_day: '2026-11-02' },
    { from_day: '2026-11-02' },
    { from_day: '2026-11-03', to_day: '2026-11-02' },
    { day: '2026-13-01' },
  ])
    expect(refusal(() => days(input))).toMatchObject({ code: 'VALIDATION_ERROR' });
});
