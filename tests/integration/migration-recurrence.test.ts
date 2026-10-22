import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import {
  migrateConfiguration,
  previewConfiguration,
} from '../../src/core/projects/configuration.js';
import { archiveTask } from '../../src/core/tasks/commands.js';
import { configureRecurrence, controlRecurrence } from '../../src/core/recurrence/control.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import {
  createRecurring,
  dayMs,
  elapsed,
  generationFixture,
  generationInput,
  generationSnapshot,
  occurrences,
  rule,
  taskRevision,
} from '../fixtures/recurrence-generations.js';
import { seedOutcomeParent } from '../fixtures/occurrence-outcomes.js';
import { ordinaryInput, type OrdinaryFixture } from '../fixtures/ordinary-work.js';

let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());
function payload(id: string, from: string, to = 'active') {
  return jsonValueSchema.parse({
    config: createDefaultProjectConfig(),
    status_mappings: [{ kind: 'recurring', from_status_id: from, to_status_id: to }],
    priority_mappings: [],
    affected_tasks: [{ task_id: id, expected_revision: taskRevision(fixture, id) }],
  });
}
function migrate(body: ReturnType<typeof payload>, revision = 1) {
  return migrateConfiguration(fixture.human, 'alpha', {
    ...ordinaryInput(fixture, body, { revision }),
    expected_settings_revision: 1,
  });
}
function archived(id: string) {
  archiveTask(fixture.human, 'alpha', id, generationInput(fixture, {}, id));
}

it('administrative archived-to-active mapping can seed a declared future elapsed anchor without a configured user edge', () => {
  const first = fixture.clock.now() + dayMs;
  const id = createRecurring(fixture, rule(first, { schedule: elapsed }));
  archived(id);
  const body = payload(id, 'archived');
  const before = generationSnapshot(fixture);
  expect(previewConfiguration(fixture.human, 'alpha', body).data.issues).toEqual([]);
  expect(generationSnapshot(fixture)).toEqual(before);
  migrate(body);
  expect(occurrences(fixture, id)).toMatchObject([
    { deadline: first, state: 'pending', actual_completed_at: null },
  ]);
  expect(
    fixture.connection.sqlite.prepare('SELECT status_id,archived_at FROM tasks WHERE id=?').get(id),
  ).toEqual({ status_id: 'active', archived_at: null });
});

it('an expired archived deferred elapsed seed requires explicit reconfiguration instead of invented historical work', () => {
  const id = createRecurring(fixture, rule(fixture.clock.now() - 3 * dayMs, { schedule: elapsed }));
  archived(id);
  const body = payload(id, 'archived');
  const before = generationSnapshot(fixture);
  expect(previewConfiguration(fixture.human, 'alpha', body).data.issues).toEqual([
    expect.objectContaining({ code: 'VALIDATION_ERROR', task_id: id }),
  ]);
  expect(generationSnapshot(fixture)).toEqual(before);
  expect(() => migrate(body)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(generationSnapshot(fixture)).toEqual(before);
  expect(occurrences(fixture, id)).toEqual([]);
});

it('administrative archived-to-active mapping preserves a missed current predecessor while waiting for real late completion', () => {
  const id = createRecurring(
    fixture,
    rule(fixture.clock.now() - dayMs, { schedule: elapsed, policy: 'record_miss', window: 0 }),
  );
  controlRecurrence(
    fixture.human,
    'alpha',
    id,
    generationInput(fixture, { to_status_id: 'active' }, id),
  );
  const history = occurrences(fixture, id);
  expect(history).toMatchObject([{ state: 'missed', actual_completed_at: null }]);
  archived(id);
  const body = payload(id, 'archived');
  expect(previewConfiguration(fixture.human, 'alpha', body).data.issues).toEqual([]);
  migrate(body);
  expect(occurrences(fixture, id)).toEqual(history);
  expect(
    fixture.connection.sqlite.prepare('SELECT status_id,archived_at FROM tasks WHERE id=?').get(id),
  ).toEqual({ status_id: 'active', archived_at: null });
});

it('draft-to-active mapping honors its explicit past seed without backfilling intervening draft dates', () => {
  const now = fixture.clock.now();
  const first = now - 3 * dayMs + 12345;
  const id = createRecurring(fixture, rule(first, { policy: 'record_miss', window: 0 }));
  const body = payload(id, 'draft');
  const before = generationSnapshot(fixture);
  expect(previewConfiguration(fixture.human, 'alpha', body).data.issues).toEqual([]);
  expect(generationSnapshot(fixture)).toEqual(before);
  migrate(body);
  const rows = occurrences(fixture, id);
  expect(rows.find((row) => row.deadline === first)).toMatchObject({
    state: 'missed',
    actual_completed_at: null,
  });
  expect(rows.some((row) => row.deadline > first && row.deadline < now)).toBe(false);
  expect(rows.every((row) => row.actual_completed_at === null)).toBe(true);
});

it.each(['calendar-next', 'expiry', 'future-next'] as const)(
  'initial activation preview detects %s supported-year overflow without staging writes',
  (boundary) => {
    const first = Date.parse(
      boundary === 'future-next' ? '9999-12-30T10:00:00.123Z' : '9999-12-31T10:00:00.123Z',
    );
    if (boundary === 'future-next') fixture.clock.set(first);
    const recurrence =
      boundary === 'expiry'
        ? rule(first, { schedule: elapsed, window: dayMs })
        : rule(first, { window: 0 });
    const id = createRecurring(fixture, recurrence);
    const body = payload(id, 'draft');
    const before = generationSnapshot(fixture);
    expect(previewConfiguration(fixture.human, 'alpha', body).data.issues).toEqual([
      expect.objectContaining({ code: 'VALIDATION_ERROR', task_id: id }),
    ]);
    expect(generationSnapshot(fixture)).toEqual(before);
    expect(() => migrate(body)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(generationSnapshot(fixture)).toEqual(before);
  },
);

it('paused-to-draft-to-active administrative mappings cannot relabel a paused generation as an initial past seed', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() - 3 * dayMs,
  });
  configureRecurrence(
    fixture.human,
    'alpha',
    parent.id,
    generationInput(
      fixture,
      rule(fixture.clock.now() - 2 * dayMs, {
        schedule: elapsed,
        policy: 'record_miss',
        window: 0,
      }),
      parent.id,
    ),
  );
  migrate(payload(parent.id, 'paused', 'draft'));
  const body = payload(parent.id, 'draft');
  const before = generationSnapshot(fixture);
  expect(previewConfiguration(fixture.human, 'alpha', body).data.issues).toEqual([
    expect.objectContaining({ code: 'VALIDATION_ERROR', task_id: parent.id }),
  ]);
  expect(generationSnapshot(fixture)).toEqual(before);
  expect(() => migrate(body, 2)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(generationSnapshot(fixture)).toEqual(before);
  expect(occurrences(fixture, parent.id)).toEqual([]);
});
