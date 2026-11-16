import { afterEach, beforeEach, expect, it } from 'vitest';
import { attachAdvisories } from '../../src/core/advisories/attach.js';
import { completeByDay } from '../../src/core/shortcuts/complete-by-day.js';
import { getRecurrence } from '../../src/core/queries/recurrence.js';
import { localTimeOf } from '../../src/core/recurrence/derive-local-time.js';
import { getTask, listTasks } from '../../src/core/queries/tasks.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';
import {
  activate,
  createRecurring,
  dayMs,
  elapsed,
  generationFixture,
  generationInput,
  generations,
  readContext,
  rule,
} from '../fixtures/recurrence-generations.js';

/** Spec 012 through the spec 010 mechanism, on a real database. */
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

function codes(operation: string, envelope: unknown, input?: unknown) {
  const advised = attachAdvisories(
    fixture.connection.db,
    { operation, projectSlug: 'alpha', input },
    envelope,
  ) as { advisories?: { code: string; subject?: { id: string } }[] };
  return advised.advisories?.map((item) => item.code) ?? [];
}
const read = (id: string) => ({
  get: codes('task.get', getTask(readContext(fixture), 'alpha', id)),
  list: codes('task.list', listTasks(readContext(fixture), { project_slug: 'alpha' })),
  recurrence: codes('recurrence.get', getRecurrence(readContext(fixture), 'alpha', id)),
});
const first = () => fixture.clock.now() + dayMs;

it('a draft says it generates nothing on every read, and stops once active (US1-1..3, FR-001, FR-003)', async () => {
  const id = createRecurring(fixture, rule(first()));
  expect(read(id)).toEqual({
    get: ['recurring_not_generating'],
    list: ['recurring_not_generating'],
    recurrence: ['recurring_not_generating'],
  });
  const changes = fixture.connection.sqlite.prepare('SELECT total_changes() AS n').pluck();
  const before = changes.get();
  read(id);
  expect(changes.get()).toBe(before);
  await activate(fixture, id);
  expect(read(id)).toEqual({ get: [], list: [], recurrence: [] });
});

it('paused and waiting after_completion tasks raise nothing (FR-002, edge case)', async () => {
  const paused = createRecurring(fixture, rule(first()));
  const api = await activate(fixture, paused);
  api.controlRecurrence(
    fixture.human,
    'alpha',
    paused,
    generationInput(fixture, { to_status_id: 'paused' }, paused),
  );
  expect(read(paused).get).toEqual([]);
  const waiting = createRecurring(fixture, rule(first(), { schedule: elapsed }));
  await activate(fixture, waiting);
  expect(read(waiting).get).toEqual([]);
});

it('an omitted local_time is derived and stated once; reads do not repeat it (US2-1, FR-005)', () => {
  const deadline = first();
  const recurrence = {
    ...rule(deadline),
    schedule: { mode: 'calendar', pattern: 'days', every: 1 },
  };
  const id = createRecurring(fixture, recurrence);
  const [generation] = generations(fixture, id);
  const expected = localTimeOf(deadline, generation?.timezone ?? 'UTC');
  expect(JSON.parse(generation?.schedule ?? '{}')).toMatchObject({ local_time: expected });
  const created = getTask(readContext(fixture), 'alpha', id);
  expect(codes('task.create', created, { recurrence })).toEqual([
    'recurring_not_generating',
    'schedule_time_derived',
  ]);
  expect(codes('task.get', created)).toEqual(['recurring_not_generating']);
});

it('equal times are as today; different ones are accepted with a mismatch until decided (US2-2/3, FR-006)', async () => {
  const deadline = first();
  const timezone = 'UTC';
  const local = localTimeOf(deadline, timezone);
  const equal = createRecurring(fixture, {
    ...rule(deadline),
    schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: local },
  });
  const zone = generations(fixture, equal)[0]?.timezone ?? timezone;
  const other = localTimeOf(deadline + 3600000, zone);
  const differ = createRecurring(fixture, {
    ...rule(deadline),
    schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: other },
  });
  const mismatch = (id: string) => read(id).get.filter((code) => code === 'schedule_time_mismatch');
  expect(zone === timezone ? mismatch(equal) : []).toEqual([]);
  expect(mismatch(differ)).toEqual(['schedule_time_mismatch']);
  await activate(fixture, differ);
  const occurrence = String(
    fixture.connection.sqlite
      .prepare('SELECT id FROM occurrences WHERE task_id = ? AND deadline = ?')
      .pluck()
      .get(differ, deadline),
  );
  completeByDay(fixture.human, 'alpha', { task: differ, occurrence });
  expect(mismatch(differ)).toEqual([]);
});
