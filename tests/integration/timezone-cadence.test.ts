import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { createProject } from '../../src/core/projects/commands.js';
import { updateSettings } from '../../src/core/projects/settings.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { controlRecurrence } from '../../src/core/recurrence/control.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import type { MutationEnvelope } from '../../src/schema/envelopes.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import {
  occurrenceRows,
  outcomeSnapshot,
  parentRevision,
} from '../fixtures/occurrence-outcomes.js';
let fixture: OrdinaryFixture;
const day = 86400000;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Календарная фаза', emoji: '🗓️' }),
  );
});
afterEach(() => fixture?.close());
function create(first: number, fortnight = false) {
  return taskDetailSchema.parse(
    createTask(fixture.human, 'alpha', {
      ...ordinaryInput(fixture, {
        kind: 'recurring',
        title: 'Календарный ритм',
        recurrence: {
          first_deadline: new Date(first).toISOString(),
          schedule: fortnight
            ? { mode: 'calendar', pattern: 'weeks', every: 2, local_time: '00:00:00.000' }
            : { mode: 'calendar', pattern: 'days', every: 1, local_time: '13:00:00.123' },
          miss_policy: 'record_miss',
          confirmation_window_ms: 0,
        },
      }),
      expected_settings_revision: 1,
    }).data,
  ).id;
}
function control(id: string, to: string, settings = 1) {
  return controlRecurrence(fixture.human, 'alpha', id, {
    ...ordinaryInput(fixture, { to_status_id: to }, { revision: parentRevision(fixture, id) }),
    expected_settings_revision: settings,
  });
}
function settings(timezone: string, revision: number): MutationEnvelope {
  return { ...ordinaryInput(fixture, { timezone }), expected_settings_revision: revision };
}
function currentGeneration(id: string) {
  return z.object({ id: z.uuid(), timezone: z.string() }).parse(
    fixture.connection.sqlite
      .prepare(
        `
    SELECT g.* FROM schedule_generations g JOIN recurrence_state s ON g.id=s.current_generation_id
    WHERE s.task_id=?`,
      )
      .get(id),
  );
}
function candidate(id: string) {
  return z
    .number()
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT next_candidate_at FROM recurrence_state WHERE task_id=?')
        .pluck()
        .get(id),
    );
}
it('every-two-week midnight continuation preserves Moscow civil date when changing to New York', () => {
  const first = Date.parse('2026-11-01T21:00:00Z'); // Monday Nov 2, 00:00 in Moscow.
  const id = create(first, true);
  control(id, 'active');
  const original = occurrenceRows(fixture, id);
  updateSettings(fixture.human, 'alpha', settings('America/New_York', 1));
  const generation = currentGeneration(id);
  const continued = occurrenceRows(fixture, id).filter(
    (row) => row.generation_id === generation.id,
  );
  expect(continued.map((row) => row.deadline)).toEqual([Date.parse('2026-11-16T05:00:00Z')]);
  const oldIds = new Set(original.map((row) => row.id));
  expect(occurrenceRows(fixture, id).filter((row) => oldIds.has(row.id))).toEqual(original);
});
it.each(['draft', 'paused'] as const)(
  'repeated %s timezone changes preserve unresolved fortnight cadence, not the effective-time cursor',
  (status) => {
    const first = Date.parse('2026-11-01T21:00:00Z');
    const id = create(first, true);
    if (status === 'paused') {
      control(id, 'active');
      control(id, 'paused');
    }
    const original = occurrenceRows(fixture, id);
    updateSettings(fixture.human, 'alpha', settings('America/New_York', 1));
    const expectedDate = status === 'draft' ? '2026-11-02' : '2026-11-16';
    expect(candidate(id)).toBe(Date.parse(`${expectedDate}T05:00:00Z`));
    fixture.clock.advanceBy(3600000);
    updateSettings(fixture.human, 'alpha', settings('Asia/Tokyo', 2));
    const expected = Date.parse(
      status === 'draft' ? '2026-11-01T15:00:00Z' : '2026-11-15T15:00:00Z',
    );
    expect(candidate(id)).toBe(expected);
    expect(occurrenceRows(fixture, id)).toEqual(original);
    control(id, 'active', 3);
    const generation = currentGeneration(id);
    expect(
      occurrenceRows(fixture, id)
        .filter((row) => row.generation_id === generation.id)
        .map((row) => row.deadline),
    ).toEqual([expected]);
    const oldIds = new Set(original.map((row) => row.id));
    expect(occurrenceRows(fixture, id).filter((row) => oldIds.has(row.id))).toEqual(original);
  },
);
it('timezone mutation retains an old-zone anchor due exactly at its effective clock boundary', () => {
  const first = fixture.clock.now();
  const id = create(first);
  control(id, 'active');
  const oldGeneration = currentGeneration(id);
  fixture.clock.set(first + 2 * day);
  updateSettings(fixture.human, 'alpha', settings('Europe/Berlin', 1));
  const oldRows = occurrenceRows(fixture, id).filter(
    (row) => row.generation_id === oldGeneration.id,
  );
  expect(oldRows.map((row) => row.deadline)).toEqual([first, first + day, first + 2 * day]);
  expect(oldRows.at(-1)).toMatchObject({
    deadline: fixture.clock.now(),
    state: 'pending',
    missed_at: null,
  });
  expect(oldRows.every((row) => row.actual_completed_at === null)).toBe(true);
});
it('shared global arrears budget refuses two individually bounded parents atomically before publishing settings or versions', () => {
  const first = fixture.clock.now();
  const firstTask = create(first);
  control(firstTask, 'active');
  const secondTask = create(first);
  control(secondTask, 'active');
  fixture.clock.set(first + 80 * day + 1);
  const before = outcomeSnapshot(fixture);
  expect(() => updateSettings(fixture.human, 'alpha', settings('Europe/Berlin', 1))).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
