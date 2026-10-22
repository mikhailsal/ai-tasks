import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { createProject } from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { createTask, archiveTask } from '../../src/core/tasks/commands.js';
import { readTaskDependencies } from '../../src/core/tasks/dependencies-read.js';
import { transitionTask } from '../../src/core/tasks/transitions.js';
import { projectConfigInputSchema } from '../../src/schema/configuration.js';
import { taskDetailSchema, type TaskDetail } from '../../src/schema/tasks.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  ordinarySnapshot,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';

let fixture: OrdinaryFixture;
let dependent: TaskDetail;
let prerequisite: TaskDetail;

function dependentConfig() {
  return projectConfigInputSchema.parse({
    ...createDefaultProjectConfig(),
    ordinary_workflow: {
      initial_status_id: 'ready',
      statuses: [
        { id: 'ready', label: 'Ожидание', category: 'not_started' },
        { id: 'work', label: 'Готово', category: 'in_progress' },
        { id: 'review', label: 'Завершено', category: 'review' },
        { id: 'done', label: 'В процессе', category: 'completed' },
      ],
      transitions: [
        { from: 'ready', to: 'work', requires_confirmation: false },
        { from: 'ready', to: 'review', requires_confirmation: false },
        { from: 'ready', to: 'done', requires_confirmation: false },
        { from: 'work', to: 'review', requires_confirmation: false },
        { from: 'work', to: 'done', requires_confirmation: false },
      ],
    },
  });
}

function prerequisiteConfig() {
  return projectConfigInputSchema.parse({
    ...createDefaultProjectConfig(),
    ordinary_workflow: {
      initial_status_id: 'waiting',
      statuses: [
        { id: 'waiting', label: 'Завершено', category: 'not_started' },
        { id: 'working', label: 'Готово', category: 'in_progress' },
        { id: 'complete', label: 'Ещё не готово', category: 'completed' },
        { id: 'cancelled', label: 'Всё сделано', category: 'cancelled' },
      ],
      transitions: [
        { from: 'waiting', to: 'working', requires_confirmation: false },
        { from: 'waiting', to: 'complete', requires_confirmation: false },
        { from: 'waiting', to: 'cancelled', requires_confirmation: false },
        { from: 'complete', to: 'working', requires_confirmation: false },
      ],
    },
  });
}

beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, {
      slug: 'alpha',
      name: 'Зависимый проект',
      emoji: '🔵',
      config: jsonValueSchema.parse(dependentConfig()),
    }),
  );
  createProject(
    fixture.human,
    'beta',
    ordinaryInput(
      fixture,
      {
        slug: 'beta',
        name: 'Другой проект',
        emoji: '🟢',
        config: jsonValueSchema.parse(prerequisiteConfig()),
      },
      { projectSlug: 'beta' },
    ),
  );
  dependent = taskDetailSchema.parse(
    createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, {
        kind: 'ordinary',
        title: 'Зависимая задача',
      }),
    ).data,
  );
  prerequisite = taskDetailSchema.parse(
    createTask(
      fixture.human,
      'beta',
      ordinaryInput(
        fixture,
        {
          kind: 'ordinary',
          title: 'Предварительная задача',
        },
        { projectSlug: 'beta' },
      ),
    ).data,
  );
  // US2 owns graph mutations. This is real migrated-fixture setup, with all production
  // ownership/kind FKs enabled, to exercise the existing-row T029 transition guard.
  fixture.connection.sqlite
    .prepare(
      `INSERT INTO task_dependencies
    (dependent_task_id, dependent_project_slug, prerequisite_task_id,
     prerequisite_project_slug, created_at, created_operation_id)
    VALUES (?, 'alpha', ?, 'beta', ?, ?)`,
    )
    .run(dependent.id, prerequisite.id, fixture.clock.now(), randomUUID());
});
afterEach(() => fixture?.close());

function changePrerequisite(status: string): void {
  prerequisite = taskDetailSchema.parse(
    transitionTask(
      fixture.human,
      'beta',
      prerequisite.id,
      ordinaryInput(
        fixture,
        { to_status_id: status },
        {
          projectSlug: 'beta',
          revision: prerequisite.revision,
        },
      ),
    ).data,
  );
}

function snapshot() {
  return {
    ...ordinarySnapshot(fixture),
    dependencies: fixture.connection.sqlite
      .prepare('SELECT * FROM task_dependencies ORDER BY dependent_task_id, prerequisite_task_id')
      .all(),
  };
}

function advanceDependent(status: string) {
  return transitionTask(
    fixture.human,
    'alpha',
    dependent.id,
    ordinaryInput(fixture, { to_status_id: status }, { revision: dependent.revision }),
  );
}

const guardCases = ['work', 'review', 'done'].flatMap((target) =>
  ['waiting', 'working', 'complete', 'cancelled'].flatMap((status) =>
    [false, true].map((archived) => ({ target, status, archived })),
  ),
);

it.each(guardCases)(
  'prerequisite $status (archived=$archived) guards ready → $target by category rather than labels',
  ({ target, status, archived }) => {
    if (status !== 'waiting') changePrerequisite(status);
    if (archived) {
      prerequisite = taskDetailSchema.parse(
        archiveTask(
          fixture.human,
          'beta',
          prerequisite.id,
          ordinaryInput(fixture, {}, { projectSlug: 'beta', revision: prerequisite.revision }),
        ).data,
      );
    }
    const before = snapshot();
    if (status !== 'complete') {
      expect(() => advanceDependent(target)).toThrowError(
        expect.objectContaining({ code: 'DEPENDENCY_BLOCKED' }),
      );
      expect(snapshot()).toEqual(before);
      return;
    }
    const result = advanceDependent(target);
    expect(taskDetailSchema.parse(result.data)).toMatchObject({
      status_id: target,
      revision: dependent.revision + 1,
      dependencies: [
        {
          prerequisite_task_id: prerequisite.id,
          prerequisite_project_slug: 'beta',
          satisfied: true,
        },
      ],
      blocked: false,
    });
    expect(result.meta.audit_ids).toHaveLength(1);
    expect(
      fixture.connection.sqlite
        .prepare('SELECT count(*) FROM operation_receipts WHERE operation_id = ?')
        .pluck()
        .get(result.meta.operation_id),
    ).toBe(1);
  },
);

it('reopening a prerequisite preserves the advanced dependent but blocks its next review/completion', () => {
  changePrerequisite('complete');
  dependent = taskDetailSchema.parse(advanceDependent('work').data);
  const row = () =>
    fixture.connection.sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(dependent.id);
  const advanced = row();
  changePrerequisite('working');
  expect(row()).toEqual(advanced);
  const before = snapshot();
  for (const target of ['review', 'done']) {
    expect(() => advanceDependent(target)).toThrowError(
      expect.objectContaining({ code: 'DEPENDENCY_BLOCKED' }),
    );
    expect(snapshot()).toEqual(before);
  }
});

it('rejects an absent prerequisite configuration snapshot before any guarded transition', () => {
  changePrerequisite('complete');
  fixture.connection.sqlite
    .prepare("UPDATE projects SET config_revision = 999 WHERE slug = 'beta'")
    .run();
  const before = snapshot();
  expect(() => advanceDependent('work')).toThrowError(
    expect.objectContaining({ code: 'INTERNAL_ERROR' }),
  );
  expect(snapshot()).toEqual(before);
  expect(() =>
    fixture.connection.db.transaction((transaction) =>
      readTaskDependencies(transaction, dependent.id),
    ),
  ).toThrowError(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
  expect(snapshot()).toEqual(before);
});
