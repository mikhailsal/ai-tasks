import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { getRecurrence } from '../../src/core/queries/recurrence.js';
import { completeOccurrences } from '../../src/core/recurrence/complete.js';
import { configureRecurrence } from '../../src/core/recurrence/control.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { readContext, rowRevision } from '../fixtures/occurrence-days.js';
import {
  control,
  lifecycleFixture,
  occurrenceRows,
  recurrenceEnvelope,
  recurrenceInput,
} from '../fixtures/recurrence-lifecycle.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';
import type { JsonValue } from '../../src/schema/values.js';

/** Spec 008 US2: declared values recorded with a completion. */
const day = 86400000;
const declared = [
  { name: 'asleep_at', kind: 'time_of_day' },
  { name: 'slept', kind: 'duration' },
  { name: 'score', kind: 'number' },
];
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await lifecycleFixture();
  fixture.clock.set(Date.parse('2026-11-10T08:00:00.000Z'));
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
async function sleepTask(values: JsonValue = declared) {
  const created = createTask(
    fixture.human,
    'alpha',
    recurrenceEnvelope(fixture, {
      kind: 'recurring',
      title: 'Сон',
      description: '',
      recurrence: { ...recurrenceInput(fixture.clock.now() + day), values },
    }),
  );
  const id = z.object({ id: z.uuid() }).parse(created.data).id;
  await control(fixture, id, 'active');
  return id;
}
function complete(id: string, values: Record<string, JsonValue>) {
  const [row] = occurrenceRows(fixture, id);
  if (!row) throw new Error('Expected an occurrence');
  return completeOccurrences(
    fixture.human,
    'alpha',
    id,
    recurrenceEnvelope(
      fixture,
      { occurrences: [{ id: row.id, expected_revision: rowRevision(fixture, row.id), values }] },
      id,
    ),
  );
}

it('declares values, records them with their kinds and shows them (FR-004, FR-005)', async () => {
  const id = await sleepTask();
  expect(getRecurrence(readContext(fixture), 'alpha', id).data).toMatchObject({
    values: declared,
  });
  const result = complete(id, { asleep_at: '23:40', slept: 450 });
  expect(JSON.stringify(result.data)).toContain(
    '"recorded_values":{"asleep_at":{"kind":"time_of_day","value":"23:40"},"slept":{"kind":"duration","value":450}}',
  );
});

it('refuses undeclared names and wrong kinds with the declared list (FR-006)', async () => {
  const id = await sleepTask();
  const allowed = ['asleep_at (time_of_day)', 'slept (duration)', 'score (number)'];
  expect(refusal(() => complete(id, { mood: 3 }))).toMatchObject({
    code: 'VALIDATION_ERROR',
    details: { field: 'values.mood', allowed },
  });
  for (const values of [{ asleep_at: '25:00' }, { slept: 7.5 }, { score: '7' }])
    expect(refusal(() => complete(id, values))).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { allowed },
    });
});

it('values stay optional; a task without declarations has no values key (FR-009)', async () => {
  const id = await sleepTask([]);
  expect(getRecurrence(readContext(fixture), 'alpha', id).data).not.toHaveProperty('values');
  expect(JSON.stringify(complete(id, {}).data)).not.toContain('recorded_values');
});

it('configure replaces or clears declarations; recorded values keep their kind', async () => {
  const id = await sleepTask();
  complete(id, { score: 7.5 });
  configureRecurrence(
    fixture.human,
    'alpha',
    id,
    recurrenceEnvelope(
      fixture,
      { ...recurrenceInput(fixture.clock.now() + 2 * day), values: [] },
      id,
    ),
  );
  expect(getRecurrence(readContext(fixture), 'alpha', id).data).not.toHaveProperty('values');
  const stored = fixture.connection.sqlite
    .prepare("SELECT recorded_values FROM occurrences WHERE state LIKE 'completed%'")
    .pluck()
    .get();
  expect(JSON.parse(String(stored))).toEqual({ score: { kind: 'number', value: 7.5 } });
  expect(
    refusal(() =>
      createTask(
        fixture.human,
        'alpha',
        recurrenceEnvelope(fixture, {
          kind: 'recurring',
          title: 'Дубли',
          description: '',
          recurrence: {
            ...recurrenceInput(fixture.clock.now() + day),
            values: [declared[0], declared[0]] as JsonValue,
          },
        }),
      ),
    ),
  ).toMatchObject({ code: 'VALIDATION_ERROR' });
});
