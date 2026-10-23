import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createContext } from '../../src/core/context.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { openDatabase } from '../../src/core/database/open.js';
import { moveBoardTask } from '../../src/core/tasks/board.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { transitionTask } from '../../src/core/tasks/transitions.js';
import { readBoardColumn } from '../../src/core/queries/board.js';
import { boardWork, boardColumn, boardInput, boardMove, boardSnapshot } from '../fixtures/board.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  taskShape,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
});
afterEach(async () => {
  await fixture?.close();
});
it('shares stable manual order across independent connections and ignores priority/deadline sorting', async () => {
  const { task, second, third } = await boardWork(fixture);
  expect(boardColumn(fixture).data.items.map((row) => row.id)).toEqual([
    task.id,
    second.id,
    third.id,
  ]);
  const request = boardInput(fixture, third.id, 'idea', task.id);
  const result = moveBoardTask(fixture.human, 'alpha', third.id, request);
  expect(result.data).toMatchObject({ revision: 2, status_id: 'idea' });
  const committed = boardSnapshot(fixture);
  expect(moveBoardTask(fixture.human, 'alpha', third.id, request)).toEqual(result);
  expect(boardSnapshot(fixture)).toEqual(committed);
  expect(() =>
    moveBoardTask(fixture.human, 'alpha', third.id, { ...request, payload: { changed: true } }),
  ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  const lock = acquireDatabaseLock({ databasePath: fixture.path, mode: 'shared' });
  const independent = openDatabase({
    path: fixture.path,
    lock,
    now: fixture.clock.now,
  });
  try {
    const response = readBoardColumn(
      createContext({ connection: independent, actor: 'human-web', now: fixture.clock.now }),
      { project_slug: 'alpha', kind: 'ordinary', status_id: 'idea' },
    );
    expect(response.data.items.map((row) => row.id)).toEqual([third.id, task.id, second.id]);
  } finally {
    independent.close();
    releaseDatabaseLock(lock);
  }
  const newest = fixture.connection.sqlite
    .prepare('SELECT action,changes FROM audit_records ORDER BY rowid DESC LIMIT 1')
    .get();
  expect(newest).toMatchObject({
    action: 'task.position',
    changes: expect.stringContaining('board_position'),
  });
});
it('atomically inserts cross-column before chosen task and appends subsequent non-positioned lifecycle entries', async () => {
  const { api, task, second, third, create } = await boardWork(fixture);
  api.transitionTask(
    fixture.human,
    'alpha',
    second.id,
    ordinaryInput(fixture, { to_status_id: 'planning' }, { revision: 1 }),
  );
  const source = boardColumn(fixture).data.order_revision;
  const target = boardColumn(fixture, 'planning').data.order_revision;
  boardMove(fixture, task.id, 'planning', second.id);
  expect(boardColumn(fixture).data.items.map((row) => row.id)).toEqual([third.id]);
  expect(boardColumn(fixture, 'planning').data.items.map((row) => row.id)).toEqual([
    task.id,
    second.id,
  ]);
  expect(boardColumn(fixture).data.order_revision).toBe(source + 1);
  expect(boardColumn(fixture, 'planning').data.order_revision).toBe(target + 1);
  const fourth = create('Четвёртая');
  expect(boardColumn(fixture).data.items.map((row) => row.id)).toEqual([third.id, fourth.id]);
  api.archiveTask(fixture.human, 'alpha', third.id, ordinaryInput(fixture, {}, { revision: 1 }));
  api.restoreTask(fixture.human, 'alpha', third.id, ordinaryInput(fixture, {}, { revision: 2 }));
  expect(boardColumn(fixture).data.items.map((row) => row.id)).toEqual([fourth.id, third.id]);
  api.transitionTask(
    fixture.human,
    'alpha',
    fourth.id,
    ordinaryInput(fixture, { to_status_id: 'planning' }, { revision: 1 }),
  );
  expect(boardColumn(fixture, 'planning').data.items.map((row) => row.id)).toEqual([
    task.id,
    second.id,
    fourth.id,
  ]);
});
it('rejects stale column revisions even when the target task version still matches', async () => {
  const { task, second, third } = await boardWork(fixture);
  const stale = boardInput(fixture, task.id);
  boardMove(fixture, third.id, 'idea', second.id);
  const before = boardSnapshot(fixture);
  expect(() => moveBoardTask(fixture.human, 'alpha', task.id, stale)).toThrowError(
    expect.objectContaining({ code: 'REVISION_CONFLICT' }),
  );
  expect(boardSnapshot(fixture)).toEqual(before);
});
it('rolls back task/status/both columns/audit when destination revision, anchor or receipt is rejected', async () => {
  const { task, betaTask } = await boardWork(fixture);
  for (const payload of [
    { expected_destination_order_revision: 99 },
    { before_task_id: betaTask.id },
    { before_task_id: task.id },
    { to_status_id: 'missing' },
  ]) {
    const before = boardSnapshot(fixture);
    expect(() =>
      moveBoardTask(
        fixture.human,
        'alpha',
        task.id,
        boardInput(fixture, task.id, 'planning', payload),
      ),
    ).toThrow();
    expect(boardSnapshot(fixture)).toEqual(before);
  }
  const before = boardSnapshot(fixture);
  fixture.connection.sqlite.exec(
    "CREATE TRIGGER reject_board_receipt BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT,'receipt failed'); END",
  );
  expect(() => boardMove(fixture, task.id, 'planning')).toThrow();
  expect(boardSnapshot(fixture)).toEqual(before);
  fixture.connection.sqlite.exec('DROP TRIGGER reject_board_receipt');
});
it('preserves epoch/config/task version, ownership, archived and payload validation guards', async () => {
  const { api, task } = await boardWork(fixture);
  const request = boardInput(fixture, task.id);
  const before = boardSnapshot(fixture);
  for (const [patch, code] of [
    [{ database_epoch: randomUUID() }, 'DATABASE_EPOCH_CONFLICT'],
    [{ expected_config_revision: 99 }, 'CONFIG_CONFLICT'],
    [{ expected_revision: 99 }, 'REVISION_CONFLICT'],
    [{ payload: {} }, 'VALIDATION_ERROR'],
  ] as const)
    expect(() =>
      moveBoardTask(fixture.human, 'alpha', task.id, { ...request, ...patch }),
    ).toThrowError(expect.objectContaining({ code }));
  expect(() => moveBoardTask(fixture.human, 'beta', task.id, request)).toThrowError(
    expect.objectContaining({ code: 'PROJECT_MISMATCH' }),
  );
  expect(boardSnapshot(fixture)).toEqual(before);
  api.archiveTask(fixture.human, 'alpha', task.id, ordinaryInput(fixture, {}, { revision: 1 }));
  const archived = boardSnapshot(fixture);
  expect(() => boardMove(fixture, task.id)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(boardSnapshot(fixture)).toEqual(archived);
});
it('uses existing consent and dependency guards instead of directly changing status', async () => {
  const { api, task } = await boardWork(fixture);
  let revision = 1;
  for (const status of ['planning', 'ready', 'in_progress', 'sanity_check']) {
    api.transitionTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, { to_status_id: status }, { revision }),
    );
    revision++;
  }
  const before = boardSnapshot(fixture);
  expect(() => boardMove(fixture, task.id, 'done')).toThrowError(
    expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }),
  );
  expect(boardSnapshot(fixture)).toEqual(before);
  const request = boardInput(fixture, task.id, 'done', {
    confirmation: { asserted: true, user_text: 'Проверено' },
  });
  expect(moveBoardTask(fixture.human, 'alpha', task.id, request).data).toMatchObject({
    status_id: 'done',
  });
});
it('pages one column with snapshot/filter identity and reports terminal statuses explicitly', async () => {
  const { task, second, third } = await boardWork(fixture);
  const first = boardColumn(fixture, 'idea', { limit: 1 });
  expect(first.data.items.map((row) => row.id)).toEqual([task.id]);
  expect(first.data.next_cursor).toEqual(expect.any(String));
  const secondPage = boardColumn(fixture, 'idea', { limit: 1, cursor: first.data.next_cursor });
  expect(secondPage.data.items.map((row) => row.id)).toEqual([second.id]);
  expect(secondPage.meta.as_of).toBe(first.meta.as_of);
  expect(() =>
    boardColumn(fixture, 'planning', { limit: 1, cursor: first.data.next_cursor }),
  ).toThrowError(expect.objectContaining({ code: 'CURSOR_STALE' }));
  expect(boardColumn(fixture, 'idea', { q: 'Третья' }).data.items.map((row) => row.id)).toEqual([
    third.id,
  ]);
  expect(() => boardColumn(fixture, 'unknown')).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
});
it('upgrades a populated prior schema with deterministic seeded order and unchanged immutable history', async () => {
  const { api, second } = await boardWork(fixture);
  api.archiveTask(fixture.human, 'alpha', second.id, ordinaryInput(fixture, {}, { revision: 1 }));
  const prior = boardSnapshot(fixture);
  fixture.connection.sqlite.exec(
    'DROP TABLE board_order; DROP TABLE board_columns; DELETE FROM __drizzle_migrations WHERE created_at=(SELECT max(created_at) FROM __drizzle_migrations)',
  );
  migrateDatabase(fixture.connection);
  const upgraded = boardSnapshot(fixture);
  for (const table of [
    'tasks',
    'audit_records',
    'operation_receipts',
    'projects',
    'project_configs',
  ])
    expect(Reflect.get(upgraded, table)).toEqual(Reflect.get(prior, table));
  const expected = fixture.connection.sqlite
    .prepare(
      "SELECT id FROM tasks WHERE project_slug='alpha' AND archived_at IS NULL AND status_id='idea' ORDER BY created_at,id",
    )
    .all();
  expect(boardColumn(fixture).data.items.map(({ id }) => ({ id }))).toEqual(expected);
  expect(fixture.connection.sqlite.prepare('SELECT count(*) FROM board_order').pluck().get()).toBe(
    fixture.connection.sqlite.prepare('SELECT count(*) FROM tasks').pluck().get(),
  );
  const once = boardSnapshot(fixture);
  migrateDatabase(fixture.connection);
  expect(boardSnapshot(fixture)).toEqual(once);
});
it('preserves recurring settings and lifecycle guards while positioning', async () => {
  await boardWork(fixture);
  const task = taskShape.parse(
    createTask(fixture.human, 'alpha', {
      ...ordinaryInput(fixture, {
        kind: 'recurring',
        title: 'Повторение',
        recurrence: {
          first_deadline: '2026-10-25T10:00:00Z',
          schedule: { mode: 'after_completion', unit: 'days', every: 1 },
          miss_policy: 'record_miss',
          confirmation_window_ms: 0,
        },
      }),
      expected_settings_revision: 1,
    }).data,
  );
  const request = boardInput(fixture, task.id, 'active');
  const before = boardSnapshot(fixture);
  expect(() => moveBoardTask(fixture.human, 'alpha', task.id, request)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(boardSnapshot(fixture)).toEqual(before);
  const result = moveBoardTask(fixture.human, 'alpha', task.id, {
    ...request,
    expected_settings_revision: 1,
  });
  expect(result.data).toMatchObject({ status_id: 'active', kind: 'recurring' });
  expect(() =>
    transitionTask(fixture.human, 'alpha', task.id, {
      ...ordinaryInput(fixture, { to_status_id: 'missing' }, { revision: 2 }),
      expected_settings_revision: 1,
    }),
  ).toThrow();
});

it('rejects dependency-blocked board transitions and archived-project order changes without partial state', async () => {
  const { api, task, second } = await boardWork(fixture);
  const { addDependency } = await import('../../src/core/tasks/dependencies.js');
  addDependency(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(
      fixture,
      { prerequisite_task_id: second.id, prerequisite_project_slug: 'alpha' },
      { revision: 1 },
    ),
  );
  api.transitionTask(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(fixture, { to_status_id: 'planning' }, { revision: 2 }),
  );
  api.transitionTask(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(fixture, { to_status_id: 'ready' }, { revision: 3 }),
  );
  const before = boardSnapshot(fixture);
  expect(() => boardMove(fixture, task.id, 'in_progress')).toThrowError(
    expect.objectContaining({ code: 'DEPENDENCY_BLOCKED' }),
  );
  expect(boardSnapshot(fixture)).toEqual(before);
  const children = fixture.connection.sqlite
    .prepare(
      "SELECT id AS task_id,revision AS expected_revision FROM tasks WHERE project_slug='alpha'",
    )
    .all();
  const { jsonValueSchema } = await import('../../src/schema/values.js');
  api.archiveProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, jsonValueSchema.parse({ affected_tasks: children }), { revision: 1 }),
  );
  const archived = boardSnapshot(fixture);
  expect(() => boardMove(fixture, second.id)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(boardSnapshot(fixture)).toEqual(archived);
});
it('supports guarded recurring archival at the end and appends on normal recurrence restoration', async () => {
  await boardWork(fixture);
  const task = taskShape.parse(
    createTask(fixture.human, 'alpha', {
      ...ordinaryInput(fixture, {
        kind: 'recurring',
        title: 'Архивировать повторение',
        recurrence: {
          first_deadline: '2026-10-25T10:00:00Z',
          schedule: { mode: 'after_completion', unit: 'days', every: 1 },
          miss_policy: 'record_miss',
          confirmation_window_ms: 0,
        },
      }),
      expected_settings_revision: 1,
    }).data,
  );
  const request = { ...boardInput(fixture, task.id, 'archived'), expected_settings_revision: 1 };
  expect(moveBoardTask(fixture.human, 'alpha', task.id, request).data).toMatchObject({
    status_id: 'archived',
    archived_at: expect.any(String),
  });
  expect(
    fixture.connection.sqlite
      .prepare('SELECT status_id FROM board_order WHERE task_id=?')
      .get(task.id),
  ).toEqual({ status_id: 'archived' });
  expect(
    readBoardColumn(fixture.human, {
      project_slug: 'alpha',
      kind: 'recurring',
      status_id: 'archived',
      archive: 'include',
      include_terminal: true,
    }).data.order_revision,
  ).toBe(2);
  const { restoreTask } = await import('../../src/core/tasks/commands.js');
  restoreTask(fixture.human, 'alpha', task.id, {
    ...ordinaryInput(fixture, {}, { revision: 2 }),
    expected_settings_revision: 1,
  });
  expect(
    readBoardColumn(fixture.human, {
      project_slug: 'alpha',
      kind: 'recurring',
      status_id: 'paused',
    }).data.items.map((row) => row.id),
  ).toEqual([task.id]);
});

it('keeps configuration mappings and project recurrence restoration consistent with column membership', async () => {
  const { task, second, third } = await boardWork(fixture);
  const { migrateConfiguration } = await import('../../src/core/projects/configuration.js');
  const { createDefaultProjectConfig } = await import('../../src/core/projects/presets.js');
  const { jsonValueSchema } = await import('../../src/schema/values.js');
  migrateConfiguration(
    fixture.human,
    'alpha',
    ordinaryInput(
      fixture,
      jsonValueSchema.parse({
        config: createDefaultProjectConfig(),
        status_mappings: [{ kind: 'ordinary', from_status_id: 'idea', to_status_id: 'planning' }],
        priority_mappings: [],
        affected_tasks: [task, second, third].map((row) => ({
          task_id: row.id,
          expected_revision: 1,
        })),
      }),
      { revision: 1 },
    ),
  );
  expect(boardColumn(fixture).data.items).toEqual([]);
  expect(new Set(boardColumn(fixture, 'planning').data.items.map((row) => row.id))).toEqual(
    new Set([task.id, second.id, third.id]),
  );
  const id = taskShape.parse(
    createTask(fixture.human, 'alpha', {
      ...ordinaryInput(fixture, {
        kind: 'recurring',
        title: 'После восстановления проекта',
        recurrence: {
          first_deadline: '2026-10-20T10:00:00Z',
          schedule: { mode: 'after_completion', unit: 'days', every: 1 },
          miss_policy: 'record_miss',
          confirmation_window_ms: 0,
        },
      }),
      expected_settings_revision: 1,
    }).data,
  ).id;
  moveBoardTask(fixture.human, 'alpha', id, {
    ...boardInput(fixture, id, 'active'),
    expected_settings_revision: 1,
  });
  const { archiveProject, restoreProject } = await import('../../src/core/projects/commands.js');
  const children = fixture.connection.sqlite
    .prepare(
      "SELECT id AS task_id,revision AS expected_revision FROM tasks WHERE project_slug='alpha'",
    )
    .all();
  archiveProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, jsonValueSchema.parse({ affected_tasks: children }), { revision: 2 }),
  );
  restoreProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, jsonValueSchema.parse({ affected_tasks: children }), { revision: 3 }),
  );
  expect(
    readBoardColumn(fixture.human, {
      project_slug: 'alpha',
      kind: 'recurring',
      status_id: 'active',
    }).data.items,
  ).toEqual([]);
  expect(
    readBoardColumn(fixture.human, {
      project_slug: 'alpha',
      kind: 'recurring',
      status_id: 'paused',
    }).data.items.map((row) => row.id),
  ).toEqual([id]);
});

it('persists archived destination entry order and rejects its stale revision independently of the source', async () => {
  await boardWork(fixture);
  const create = () =>
    taskShape.parse(
      createTask(fixture.human, 'alpha', {
        ...ordinaryInput(fixture, {
          kind: 'recurring',
          title: 'Архивный порядок',
          recurrence: {
            first_deadline: '2026-10-25T10:00:00Z',
            schedule: { mode: 'after_completion', unit: 'days', every: 1 },
            miss_policy: 'record_miss',
            confirmation_window_ms: 0,
          },
        }),
        expected_settings_revision: 1,
      }).data,
    );
  const older = create();
  fixture.clock.advanceBy(1000);
  const newer = create();
  const archived = () =>
    readBoardColumn(fixture.human, {
      project_slug: 'alpha',
      kind: 'recurring',
      status_id: 'archived',
      archive: 'include',
      include_terminal: true,
    });
  const emptyRevision = archived().data.order_revision;
  transitionTask(fixture.human, 'alpha', newer.id, {
    ...ordinaryInput(fixture, { to_status_id: 'archived' }, { revision: 1 }),
    expected_settings_revision: 1,
  });
  expect(archived().data.order_revision).toBe(emptyRevision + 1);
  const stale = {
    ...boardInput(fixture, older.id, 'archived', {
      expected_destination_order_revision: emptyRevision,
    }),
    expected_settings_revision: 1,
  };
  const before = boardSnapshot(fixture);
  expect(() => moveBoardTask(fixture.human, 'alpha', older.id, stale)).toThrowError(
    expect.objectContaining({ code: 'REVISION_CONFLICT' }),
  );
  expect(boardSnapshot(fixture)).toEqual(before);
  transitionTask(fixture.human, 'alpha', older.id, {
    ...ordinaryInput(fixture, { to_status_id: 'archived' }, { revision: 1 }),
    expected_settings_revision: 1,
  });
  expect(archived().data.items.map((row) => row.id)).toEqual([newer.id, older.id]);
  expect(archived().data.order_revision).toBe(emptyRevision + 2);
});

it('bounds indexed position scans to the addressed project, kind and configured column', async () => {
  await boardWork(fixture);
  const { z } = await import('zod/mini');
  const plan = z
    .array(z.object({ detail: z.string() }))
    .parse(
      fixture.connection.sqlite
        .prepare(
          'EXPLAIN QUERY PLAN SELECT task_id FROM board_order WHERE project_slug=? AND kind=? AND status_id=? ORDER BY position,task_id',
        )
        .all('alpha', 'ordinary', 'idea'),
    );
  expect(plan.map((row) => row.detail).join('\n')).toContain(
    'USING COVERING INDEX board_order_column_position (project_slug=? AND kind=? AND status_id=?)',
  );
});

it('keeps board paging read-only with a constant query count for one versus fifty cards', async () => {
  const { create } = await boardWork(fixture);
  for (let index = 0; index < 50; index++) create(`Объём ${index}`);
  const nativePrepare = fixture.connection.sqlite.prepare.bind(fixture.connection.sqlite);
  function read(limit: number) {
    let calls = 0;
    const spy = vi.spyOn(fixture.connection.sqlite, 'prepare').mockImplementation((sql: string) => {
      if (/^\s*(select|with)\b/iu.test(sql)) calls++;
      return nativePrepare(sql);
    });
    try {
      return { result: boardColumn(fixture, 'idea', { limit }), calls };
    } finally {
      spy.mockRestore();
    }
  }
  const before = boardSnapshot(fixture);
  const one = read(1),
    fifty = read(50);
  expect(one.result.data.items).toHaveLength(1);
  expect(fifty.result.data.items).toHaveLength(50);
  expect(fifty.calls).toBe(one.calls);
  expect(fifty.calls).toBeLessThanOrEqual(10);
  expect(boardSnapshot(fixture)).toEqual(before);
});
