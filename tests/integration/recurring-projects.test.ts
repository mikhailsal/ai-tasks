import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { createProject } from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import {
  migrateConfiguration,
  previewConfiguration,
} from '../../src/core/projects/configuration.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { controlRecurrence } from '../../src/core/recurrence/control.js';
import { tickRecurrence } from '../../src/core/recurrence/tick.js';
import {
  configurationMigrationSchema,
  type ConfigurationMigration,
} from '../../src/schema/configuration-migration.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import { jsonValueSchema } from '../../src/schema/values.js';
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
  assertOutcomeCommit,
} from '../fixtures/occurrence-outcomes.js';
let fixture: OrdinaryFixture;
const day = 86400000;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Миграции повторений', emoji: '🌅' }),
  );
});
afterEach(() => fixture?.close());
function createActive(
  options: {
    calendar?: boolean;
    first?: number;
    policy?: 'carry_forward' | 'record_miss';
  } = {},
) {
  const result = createTask(fixture.human, 'alpha', {
    ...ordinaryInput(fixture, {
      kind: 'recurring',
      title: 'Изменяемая повторяемая работа',
      emoji: '🧪',
      description: '  **Сохранённая инструкция**\n',
      recurrence: {
        first_deadline: new Date(options.first ?? fixture.clock.now() + day).toISOString(),
        schedule: options.calendar
          ? { mode: 'calendar', pattern: 'days', every: 1, local_time: '13:00:00.123' }
          : { mode: 'after_completion', unit: 'hours', every: 1 },
        miss_policy: options.policy ?? 'carry_forward',
        confirmation_window_ms: 0,
      },
    }),
    expected_settings_revision: 1,
  });
  const task = taskDetailSchema.parse(result.data);
  controlRecurrence(fixture.human, 'alpha', task.id, {
    ...ordinaryInput(fixture, { to_status_id: 'active' }, { revision: task.revision }),
    expected_settings_revision: 1,
  });
  return task.id;
}
function proposal(id: string, to = 'paused'): ConfigurationMigration {
  return configurationMigrationSchema.parse({
    config: createDefaultProjectConfig(),
    status_mappings: [{ kind: 'recurring', from_status_id: 'active', to_status_id: to }],
    priority_mappings: [],
    affected_tasks: [{ task_id: id, expected_revision: parentRevision(fixture, id) }],
  });
}
function envelope(payload: ConfigurationMigration): MutationEnvelope {
  const revision = z
    .number()
    .parse(
      fixture.connection.sqlite
        .prepare("SELECT config_revision FROM projects WHERE slug='alpha'")
        .pluck()
        .get(),
    );
  return {
    ...ordinaryInput(fixture, jsonValueSchema.parse(payload), { revision }),
    expected_settings_revision: 1,
  };
}
function preview(payload: ConfigurationMigration) {
  const before = outcomeSnapshot(fixture);
  const result = previewConfiguration(fixture.human, 'alpha', jsonValueSchema.parse(payload));
  expect(outcomeSnapshot(fixture)).toEqual(before);
  return result;
}
function rows(table: 'recurrence_state' | 'recurrence_intervals' | 'schedule_generations') {
  return fixture.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}
function rejectCommit(input: MutationEnvelope, code: string) {
  const before = outcomeSnapshot(fixture);
  expect(() => migrateConfiguration(fixture.human, 'alpha', input)).toThrowError(
    expect.objectContaining({ code }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
}
it.each(['pending', 'debt', 'owed'] as const)(
  'retirement migration refuses %s with a pure preview and no partial committed state',
  (state) => {
    const id = createActive({
      calendar: state === 'owed',
      first: state === 'debt' ? fixture.clock.now() - 1 : fixture.clock.now() + day,
    });
    if (state === 'owed') fixture.clock.advanceBy(200 * day);
    const payload = proposal(id, 'archived');
    const result = preview(payload);
    expect(result.data.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'VALIDATION_ERROR', task_id: id })]),
    );
    if (state === 'owed')
      expect(result.data.issues.map((issue) => issue.message).join(' ')).toMatch(/tick|owed/iu);
    rejectCommit(envelope(payload), 'VALIDATION_ERROR');
  },
);
it.each(['missing', 'stale'] as const)(
  'recurring category migration requires current settings: %s',
  (kind) => {
    const id = createActive();
    const payload = proposal(id);
    expect(preview(payload).data.issues).toEqual([]);
    const input = envelope(payload);
    if (kind === 'missing') delete input.expected_settings_revision;
    else input.expected_settings_revision = 2;
    rejectCommit(input, kind === 'missing' ? 'VALIDATION_ERROR' : 'CONFIG_CONFLICT');
  },
);
it('category migration pauses administratively while retaining owed anchors, captured snapshots and immutable old audit', () => {
  const id = createActive({ calendar: true, first: fixture.clock.now() });
  const original = occurrenceRows(fixture, id);
  const oldAudit = fixture.connection.sqlite
    .prepare('SELECT * FROM audit_records ORDER BY rowid')
    .all();
  fixture.clock.advanceBy(3 * day);
  const payload = proposal(id);
  expect(preview(payload).data.issues).toEqual([]);
  const result = migrateConfiguration(fixture.human, 'alpha', envelope(payload));
  expect(
    fixture.connection.sqlite.prepare('SELECT status_id FROM tasks WHERE id=?').pluck().get(id),
  ).toBe('paused');
  expect(occurrenceRows(fixture, id)).toEqual(original);
  expect(
    fixture.connection.sqlite
      .prepare('SELECT * FROM audit_records ORDER BY rowid')
      .all()
      .slice(0, oldAudit.length),
  ).toEqual(oldAudit);
  const events = assertOutcomeCommit(fixture, result);
  const taskEvent = events.find((event) => event.entity_id === id);
  if (!taskEvent) throw new Error('Expected semantic recurring task migration event');
  expect(JSON.parse(taskEvent.changes)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'status_id', before: 'active', after: 'paused' }),
    ]),
  );
  expect(JSON.parse(taskEvent.config_snapshot ?? 'null')).toMatchObject({
    revision: 2,
    previous: { revision: 1 },
  });
  const pausedAt = fixture.clock.now();
  fixture.clock.advanceBy(5 * day);
  tickRecurrence(fixture.human, 'alpha', {
    ...ordinaryInput(fixture, {
      tasks: [{ task_id: id, expected_revision: parentRevision(fixture, id) }],
    }),
    expected_settings_revision: 1,
  });
  const stored = occurrenceRows(fixture, id);
  expect(stored.filter((row) => row.deadline >= pausedAt)).toEqual([]);
  expect(stored).toHaveLength(3);
  expect(stored.every((row) => row.state === 'debt' && row.actual_completed_at === null)).toBe(
    true,
  );
});
it.each(['status-key', 'priority', 'labels'] as const)(
  'same-behavior %s migration needs no settings token or recurrence state rewrite',
  (kind) => {
    const id = createActive();
    const config = createDefaultProjectConfig();
    let payload = configurationMigrationSchema.parse({
      config,
      status_mappings: [],
      priority_mappings: [],
      affected_tasks: [],
    });
    if (kind === 'status-key')
      payload = configurationMigrationSchema.parse({
        ...payload,
        config: {
          ...config,
          recurring_workflow: {
            ...config.recurring_workflow,
            statuses: [
              ...config.recurring_workflow.statuses,
              { id: 'running', label: 'Другое имя работы', category: 'active' },
            ],
          },
        },
        status_mappings: [{ kind: 'recurring', from_status_id: 'active', to_status_id: 'running' }],
        affected_tasks: [{ task_id: id, expected_revision: parentRevision(fixture, id) }],
      });
    if (kind === 'priority')
      payload = configurationMigrationSchema.parse({
        ...payload,
        priority_mappings: [{ from: null, to: { model: 'classic', level: 'high' } }],
        affected_tasks: [{ task_id: id, expected_revision: parentRevision(fixture, id) }],
      });
    if (kind === 'labels')
      payload = configurationMigrationSchema.parse({
        ...payload,
        config: {
          ...config,
          recurring_workflow: {
            ...config.recurring_workflow,
            statuses: config.recurring_workflow.statuses.map((status) =>
              status.id === 'active'
                ? { ...status, label: 'Новое видимое имя', color: 'blue' }
                : status,
            ),
          },
        },
      });
    const previous = [
      rows('recurrence_state'),
      rows('recurrence_intervals'),
      rows('schedule_generations'),
    ];
    const snapshots = occurrenceRows(fixture, id);
    const revision = parentRevision(fixture, id);
    expect(preview(payload).data.issues).toEqual([]);
    const input = envelope(payload);
    delete input.expected_settings_revision;
    migrateConfiguration(fixture.human, 'alpha', input);
    expect([
      rows('recurrence_state'),
      rows('recurrence_intervals'),
      rows('schedule_generations'),
    ]).toEqual(previous);
    expect(occurrenceRows(fixture, id)).toEqual(snapshots);
    expect(parentRevision(fixture, id)).toBe(kind === 'labels' ? revision : revision + 1);
  },
);
it('recurring category migration receipt rollback and exact replay keep interval, task, configuration and audit atomic', () => {
  const id = createActive();
  const payload = proposal(id);
  const input = envelope(payload);
  const before = outcomeSnapshot(fixture);
  fixture.connection.sqlite
    .exec(`CREATE TRIGGER reject_recurring_migration BEFORE INSERT ON operation_receipts
    BEGIN SELECT RAISE(ABORT, 'injected recurring migration persistence failure'); END`);
  expect(() => migrateConfiguration(fixture.human, 'alpha', input)).toThrow();
  expect(outcomeSnapshot(fixture)).toEqual(before);
  fixture.connection.sqlite.exec('DROP TRIGGER reject_recurring_migration');
  const result = migrateConfiguration(fixture.human, 'alpha', input);
  assertOutcomeCommit(fixture, result);
  const committed = outcomeSnapshot(fixture);
  fixture.clock.advanceBy(day);
  expect(migrateConfiguration(fixture.human, 'alpha', input)).toEqual(result);
  expect(outcomeSnapshot(fixture)).toEqual(committed);
  const changed = {
    ...input,
    payload: jsonValueSchema.parse({
      ...payload,
      config: {
        ...payload.config,
        priority_model: { type: 'numeric', min: 0, max: 100, direction: 'higher' },
      },
    }),
  };
  rejectCommit(changed, 'IDEMPOTENCY_CONFLICT');
});
