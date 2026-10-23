import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/mini';
import { createProject } from '../../src/core/projects/commands.js';
import { migrateConfiguration } from '../../src/core/projects/configuration.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { getProjectConfiguration } from '../../src/core/queries/configuration.js';
import { createTask, updateTask, archiveTask, restoreTask } from '../../src/core/tasks/commands.js';
import { transitionTask } from '../../src/core/tasks/transitions.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { controlRecurrence } from '../../src/core/recurrence/control.js';
import { tickRecurrence } from '../../src/core/recurrence/tick.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import {
  projectConfigInputSchema,
  type ProjectConfigInput,
} from '../../src/schema/configuration.js';
import { generationInput, rule } from '../fixtures/recurrence-generations.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  ordinarySnapshot,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import { insertStorageRow, taskRow } from '../fixtures/storage-seed.js';
let fixture: OrdinaryFixture;
function initialConfig() {
  const config = createDefaultProjectConfig();
  config.ordinary_workflow.statuses.push({
    id: 'accepted',
    label: 'Принято',
    category: 'completed',
  });
  config.ordinary_workflow.transitions.push(
    { from: 'idea', to: 'done', requires_confirmation: false },
    { from: 'idea', to: 'in_progress', requires_confirmation: false },
    { from: 'in_progress', to: 'done', requires_confirmation: false },
    { from: 'done', to: 'accepted', requires_confirmation: false },
    { from: 'accepted', to: 'in_progress', requires_confirmation: false },
  );
  return config;
}
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(
      fixture,
      jsonValueSchema.parse({
        slug: 'alpha',
        name: 'Время завершения',
        emoji: '🕰️',
        config: initialConfig(),
      }),
    ),
  );
});
afterEach(() => fixture.close());
const rowSchema = z.looseObject(
  z.object({
    id: z.uuid(),
    revision: z.number(),
    status_id: z.string(),
    completion_recorded_at: z.optional(z.nullable(z.number())),
  }).shape,
);
function row(id: string) {
  // SELECT * makes the pre-implementation RED a missing-fact assertion, not missing-column SQL.
  return rowSchema.parse(
    fixture.connection.sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(id),
  );
}
function create() {
  return taskDetailSchema.parse(
    createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, {
        kind: 'ordinary',
        title: 'Точное завершение',
        description: 'Исходник  ',
      }),
    ).data,
  ).id;
}
function input(id: string, payload: JsonValue) {
  return ordinaryInput(fixture, payload, { revision: row(id).revision });
}
function move(id: string, to: string) {
  return transitionTask(fixture.human, 'alpha', id, input(id, { to_status_id: to }));
}
function currentConfig() {
  const current = getProjectConfiguration(fixture.human, 'alpha').data;
  return projectConfigInputSchema.parse({
    priority_model: current.priority_model,
    ordinary_workflow: current.ordinary_workflow,
    recurring_workflow: current.recurring_workflow,
  });
}
function migrate(id: string, config: ProjectConfigInput, from?: string, to?: string) {
  const revision = getProjectConfiguration(fixture.human, 'alpha').data.revision;
  return migrateConfiguration(
    fixture.human,
    'alpha',
    ordinaryInput(
      fixture,
      jsonValueSchema.parse({
        config,
        status_mappings:
          from === undefined
            ? []
            : [{ kind: 'ordinary', from_status_id: from, to_status_id: to ?? from }],
        priority_mappings: [],
        affected_tasks:
          from === undefined ? [] : [{ task_id: id, expected_revision: row(id).revision }],
      }),
      { revision },
    ),
  );
}
function replayCompletionMigration() {
  // Reconstruct the populated schema immediately before 0002. Later migration
  // records must also be removed: Drizzle resumes after the newest timestamp.
  fixture.connection.sqlite.exec('DROP TABLE board_order; DROP TABLE board_columns');
  fixture.connection.sqlite.exec('ALTER TABLE tasks DROP COLUMN completion_recorded_at');
  fixture.connection.sqlite
    .prepare('DELETE FROM __drizzle_migrations WHERE created_at>=?')
    .run(1792627200000);
  migrateDatabase(fixture.connection);
}
it('a successful ordinary completion persists its captured recording clock [US4 behavioral RED]', () => {
  const id = create();
  fixture.clock.advanceBy(1234);
  const result = move(id, 'done');
  expect(result.data).toMatchObject({ id, category: 'completed' });
  expect(row(id).completion_recorded_at).toBe(fixture.clock.now());
});
it('completion-to-completion moves, content edits, archive and restore preserve the original recording fact', () => {
  const id = create();
  move(id, 'done');
  const recorded = fixture.clock.now();
  fixture.clock.advanceBy(1000);
  move(id, 'accepted');
  expect(row(id).completion_recorded_at).toBe(recorded);
  fixture.clock.advanceBy(1000);
  updateTask(
    fixture.human,
    'alpha',
    id,
    input(id, { description: 'После завершения: точный исходник  ' }),
  );
  expect(row(id).completion_recorded_at).toBe(recorded);
  fixture.clock.advanceBy(1000);
  archiveTask(fixture.human, 'alpha', id, input(id, {}));
  expect(row(id).completion_recorded_at).toBe(recorded);
  fixture.clock.advanceBy(1000);
  restoreTask(fixture.human, 'alpha', id, input(id, {}));
  expect(row(id)).toMatchObject({ status_id: 'accepted', completion_recorded_at: recorded });
});
it('leaving completed clears the fact and a later completion uses its new recording instant', () => {
  const id = create();
  expect(row(id).completion_recorded_at).toBeNull();
  move(id, 'done');
  const first = fixture.clock.now();
  fixture.clock.advanceBy(1000);
  move(id, 'in_progress');
  expect(row(id).completion_recorded_at).toBeNull();
  fixture.clock.advanceBy(1000);
  move(id, 'done');
  expect(row(id).completion_recorded_at).toBe(fixture.clock.now());
  expect(row(id).completion_recorded_at).not.toBe(first);
});
it('configuration category changes on the same status ID set and clear ordinary completion time', () => {
  const id = create();
  move(id, 'in_progress');
  const completed = currentConfig();
  completed.ordinary_workflow.statuses = completed.ordinary_workflow.statuses.map((status) =>
    status.id === 'in_progress' ? { ...status, category: 'completed' } : status,
  );
  fixture.clock.advanceBy(1000);
  migrate(id, completed, 'in_progress');
  expect(row(id)).toMatchObject({
    status_id: 'in_progress',
    completion_recorded_at: fixture.clock.now(),
  });
  const reopened = currentConfig();
  reopened.ordinary_workflow.statuses = reopened.ordinary_workflow.statuses.map((status) =>
    status.id === 'in_progress' ? { ...status, category: 'in_progress' } : status,
  );
  fixture.clock.advanceBy(1000);
  migrate(id, reopened, 'in_progress');
  expect(row(id)).toMatchObject({ status_id: 'in_progress', completion_recorded_at: null });
});
it('completed status remapping and later label-only configuration edits preserve completion time', () => {
  const id = create();
  move(id, 'done');
  const recorded = fixture.clock.now();
  const mapped = currentConfig();
  mapped.ordinary_workflow.statuses = mapped.ordinary_workflow.statuses.filter(
    (status) => status.id !== 'done',
  );
  mapped.ordinary_workflow.transitions = mapped.ordinary_workflow.transitions.filter(
    (edge) => edge.from !== 'done' && edge.to !== 'done',
  );
  fixture.clock.advanceBy(1000);
  migrate(id, mapped, 'done', 'accepted');
  expect(row(id)).toMatchObject({ status_id: 'accepted', completion_recorded_at: recorded });
  const renamed = currentConfig();
  renamed.ordinary_workflow.statuses = renamed.ordinary_workflow.statuses.map((status) => ({
    ...status,
    label: `${status.label}!`,
  }));
  fixture.clock.advanceBy(1000);
  migrate(id, renamed);
  expect(row(id).completion_recorded_at).toBe(recorded);
});
it('exact completion receipt replay never changes its timestamp or any persisted state', () => {
  const id = create();
  const proposal = input(id, { to_status_id: 'done' });
  const result = transitionTask(fixture.human, 'alpha', id, proposal);
  const recorded = fixture.clock.now();
  const before = ordinarySnapshot(fixture);
  fixture.clock.advanceBy(10000);
  expect(transitionTask(fixture.human, 'alpha', id, proposal)).toEqual(result);
  expect(ordinarySnapshot(fixture)).toEqual(before);
  expect(row(id).completion_recorded_at).toBe(recorded);
});
it.each(['transition', 'configuration'] as const)(
  'receipt failure rolls back a %s completion fact with all state/history',
  (operation) => {
    const id = create();
    if (operation === 'configuration') move(id, 'in_progress');
    const config = currentConfig();
    config.ordinary_workflow.statuses = config.ordinary_workflow.statuses.map((status) =>
      status.id === 'in_progress' ? { ...status, category: 'completed' } : status,
    );
    const before = ordinarySnapshot(fixture);
    fixture.connection.sqlite.exec(
      "CREATE TRIGGER reject_completion_receipt BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT, 'injected completion receipt failure'); END",
    );
    const perform = () =>
      operation === 'transition' ? move(id, 'done') : migrate(id, config, 'in_progress');
    expect(perform).toThrow();
    expect(ordinarySnapshot(fixture)).toEqual(before);
    fixture.connection.sqlite.exec('DROP TRIGGER reject_completion_receipt');
    fixture.clock.advanceBy(1000);
    perform();
    expect(row(id).completion_recorded_at).toBe(fixture.clock.now());
  },
);
it('users cannot write the internal timestamp through ordinary creation or content patch', () => {
  const before = ordinarySnapshot(fixture);
  expect(() =>
    createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, {
        kind: 'ordinary',
        title: 'Подмена',
        completion_recorded_at: fixture.clock.now(),
      }),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(ordinarySnapshot(fixture)).toEqual(before);
  const id = create();
  const created = ordinarySnapshot(fixture);
  expect(() =>
    updateTask(
      fixture.human,
      'alpha',
      id,
      input(id, { completion_recorded_at: fixture.clock.now() }),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(ordinarySnapshot(fixture)).toEqual(created);
});
it('recurring creation, activation and ticks always leave the ordinary completion fact null', () => {
  const id = taskDetailSchema.parse(
    createTask(
      fixture.human,
      'alpha',
      generationInput(fixture, {
        kind: 'recurring',
        title: 'Повторение',
        recurrence: rule(fixture.clock.now()),
      }),
    ).data,
  ).id;
  expect(row(id).completion_recorded_at).toBeNull();
  controlRecurrence(
    fixture.human,
    'alpha',
    id,
    generationInput(fixture, { to_status_id: 'active' }, id),
  );
  expect(row(id).completion_recorded_at).toBeNull();
  tickRecurrence(
    fixture.human,
    'alpha',
    generationInput(fixture, { tasks: [{ task_id: id, expected_revision: row(id).revision }] }),
  );
  expect(row(id).completion_recorded_at).toBeNull();
});
it('the additive migration backfills a complete single-epoch chain without using later edit time or altering history', () => {
  const id = create();
  move(id, 'done');
  const recorded = fixture.clock.now();
  fixture.clock.advanceBy(1000);
  move(id, 'accepted');
  fixture.clock.advanceBy(1000);
  updateTask(fixture.human, 'alpha', id, input(id, { description: 'Поздняя правка' }));
  const before = ordinarySnapshot(fixture);
  replayCompletionMigration();
  expect(row(id).completion_recorded_at).toBe(recorded);
  expect(ordinarySnapshot(fixture)).toEqual(before);
  migrateDatabase(fixture.connection);
  expect(ordinarySnapshot(fixture)).toEqual(before);
});
it('migration leaves mixed-epoch or absent completion history unknown instead of guessing from updated_at', () => {
  const id = create();
  move(id, 'done');
  const epoch = randomUUID();
  fixture.connection.sqlite
    .prepare('UPDATE application_state SET database_epoch=? WHERE id=1')
    .run(epoch);
  updateTask(fixture.human, 'alpha', id, {
    ...input(id, { description: 'Другая ветка эпохи' }),
    database_epoch: epoch,
  });
  const legacy = randomUUID();
  insertStorageRow(fixture.connection.sqlite, 'tasks', taskRow({ id: legacy, status_id: 'done' }));
  const history = fixture.connection.sqlite
    .prepare('SELECT * FROM audit_records ORDER BY rowid')
    .all();
  replayCompletionMigration();
  expect(row(id).completion_recorded_at).toBeNull();
  expect(row(legacy).completion_recorded_at).toBeNull();
  expect(
    fixture.connection.sqlite.prepare('SELECT * FROM audit_records ORDER BY rowid').all(),
  ).toEqual(history);
});
it('storage rejects fractional completion facts and every non-null recurring completion fact', () => {
  const id = create();
  expect(() =>
    fixture.connection.sqlite
      .prepare('UPDATE tasks SET completion_recorded_at=? WHERE id=?')
      .run(1.5, id),
  ).toThrow();
  const recurring = taskDetailSchema.parse(
    createTask(
      fixture.human,
      'alpha',
      generationInput(fixture, {
        kind: 'recurring',
        title: 'Без обычного завершения',
        recurrence: rule(fixture.clock.now()),
      }),
    ).data,
  ).id;
  expect(() =>
    fixture.connection.sqlite
      .prepare('UPDATE tasks SET completion_recorded_at=? WHERE id=?')
      .run(fixture.clock.now(), recurring),
  ).toThrow();
  expect(row(id).completion_recorded_at).toBeNull();
  expect(row(recurring).completion_recorded_at).toBeNull();
});
