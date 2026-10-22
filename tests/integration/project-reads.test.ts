import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContext } from '../../src/core/context.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import {
  createProject,
  updateProject,
  archiveProject,
  restoreProject,
} from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { getProject, listProjects } from '../../src/core/queries/projects.js';
import {
  getProjectConfiguration,
  readConfigPresets,
} from '../../src/core/queries/configuration.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createDatabaseFixture, type DatabaseFixture } from '../fixtures/database.js';
import { createTestClock } from '../fixtures/clock.js';
import {
  configRow,
  insertStorageRow,
  projectRow,
  seedTime,
  taskRow,
} from '../fixtures/storage-seed.js';

let fixture: DatabaseFixture<ReturnType<typeof openDatabase>>;
let clock: ReturnType<typeof createTestClock>;
let context: ReturnType<typeof createContext>;
beforeEach(async () => {
  clock = createTestClock(seedTime);
  fixture = await createDatabaseFixture(
    { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock },
    clock,
  );
  context = createContext({ connection: fixture.connection, actor: 'human-web' });
  const config = createDefaultProjectConfig();
  for (const [slug, emoji, priority, archivedAt] of [
    ['alpha', '🚀', 5, null],
    ['beta', '🧭', 5, null],
    ['gamma', '📚', -1, null],
    ['delta', '🧰', 100, seedTime],
  ] as const) {
    insertStorageRow(
      fixture.connection.sqlite,
      'projects',
      projectRow({ slug, emoji, emoji_key: emoji, priority, archived_at: archivedAt }),
    );
    insertStorageRow(
      fixture.connection.sqlite,
      'project_configs',
      configRow({
        project_slug: slug,
        priority_model: JSON.stringify(config.priority_model),
        ordinary_workflow: JSON.stringify(config.ordinary_workflow),
        recurring_workflow: JSON.stringify(config.recurring_workflow),
        semantic_snapshot: JSON.stringify(config),
      }),
    );
  }
});
afterEach(async () => {
  await fixture?.close();
});

function snapshot() {
  return Object.fromEntries(
    [
      'application_state',
      'projects',
      'project_configs',
      'tasks',
      'audit_records',
      'operation_receipts',
      'project_emoji_reservations',
      'task_emoji_reservations',
    ].map((table) => [
      table,
      fixture.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}
function firstCursor(): string {
  const cursor = listProjects(context, { all_projects: true, limit: 1 }).data.next_cursor;
  if (!cursor) throw new Error('Expected a second project page');
  return cursor;
}

describe('coherent pure project and configuration reads', () => {
  it('returns canonical detail and configuration without changing durable state or exposing storage IDs', () => {
    const before = snapshot();
    expect(getProject(context, 'alpha').data).toEqual({
      slug: 'alpha',
      name: 'Alpha',
      description: '',
      emoji: '🚀',
      priority: 5,
      archived_at: null,
      revision: 1,
      config_revision: 1,
      created_at: new Date(seedTime).toISOString(),
      updated_at: new Date(seedTime).toISOString(),
    });
    expect(getProjectConfiguration(context, 'alpha').data).toEqual({
      revision: 1,
      ...createDefaultProjectConfig(),
    });
    expect(getProject(context, 'delta').data.archived_at).toBe(new Date(seedTime).toISOString());
    expect(() => getProject(context, 'missing')).toThrow(
      expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }),
    );
    expect(() => getProject(context, 'Invalid')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(snapshot()).toEqual(before);
  });
  it('orders projects by priority descending then slug and applies explicit scope/archive filters', () => {
    const before = snapshot();
    expect(listProjects(context, { all_projects: true }).data.items.map((row) => row.slug)).toEqual(
      ['alpha', 'beta', 'gamma'],
    );
    expect(
      listProjects(context, { all_projects: true, archive: 'include' }).data.items.map(
        (row) => row.slug,
      ),
    ).toEqual(['delta', 'alpha', 'beta', 'gamma']);
    expect(
      listProjects(context, { all_projects: true, archive: 'only' }).data.items.map(
        (row) => row.slug,
      ),
    ).toEqual(['delta']);
    expect(
      listProjects(context, { project_slug: 'beta' }).data.items.map((row) => row.slug),
    ).toEqual(['beta']);
    expect(listProjects(context, { project_slug: 'delta' }).data).toEqual({
      items: [],
      next_cursor: null,
    });
    expect(() => listProjects(context, { project_slug: 'missing' })).toThrow(
      expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }),
    );
    expect(snapshot()).toEqual(before);
  });
  it('uses a default page of 50 and supports a maximum of 200', () => {
    for (let index = 0; index < 50; index += 1) {
      const emoji = String.fromCodePoint(0x1f600 + index);
      insertStorageRow(
        fixture.connection.sqlite,
        'projects',
        projectRow({ slug: `extra-${index}`, emoji, emoji_key: emoji }),
      );
    }
    const first = listProjects(context, { all_projects: true });
    expect(first.data.items).toHaveLength(50);
    expect(first.data.next_cursor).not.toBeNull();
    const all = listProjects(context, { all_projects: true, limit: 200 });
    expect(all.data.items).toHaveLength(53);
    expect(all.data.next_cursor).toBeNull();
    for (const limit of [0, -1, 201, 1.5]) {
      expect(() => listProjects(context, { all_projects: true, limit })).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
    }
  });
  it('retains the first-page as_of across pages while now advances and a fresh page gets a fresh snapshot time', () => {
    const before = snapshot();
    const first = listProjects(context, { all_projects: true, limit: 1 });
    const cursor = first.data.next_cursor;
    if (!cursor) throw new Error('Expected a second project page');
    clock.advanceBy(60_000);
    const second = listProjects(context, { all_projects: true, limit: 1, cursor });
    expect(first.data.items[0]?.slug).toBe('alpha');
    expect(second.data.items[0]?.slug).toBe('beta');
    expect(second.meta.as_of).toBe(first.meta.as_of);
    expect(second.meta.now).toBe(new Date(clock.now()).toISOString());
    expect(second.meta.now).not.toBe(second.meta.as_of);
    expect(listProjects(context, { all_projects: true, limit: 1 }).meta.as_of).toBe(
      second.meta.now,
    );
    expect(snapshot()).toEqual(before);
  });
  it('rejects cursor reuse across filter, scope and limit changes', () => {
    const cursor = firstCursor();
    for (const input of [
      { all_projects: true as const, archive: 'include' as const, limit: 1, cursor },
      { project_slug: 'alpha', limit: 1, cursor },
      { all_projects: true as const, limit: 2, cursor },
    ])
      expect(() => listProjects(context, input)).toThrow(
        expect.objectContaining({ code: 'CURSOR_STALE' }),
      );
  });
  it.each(['read_revision', 'database_epoch'])('rejects a cursor after %s changes', (field) => {
    const cursor = firstCursor();
    fixture.connection.sqlite
      .prepare(`UPDATE application_state SET ${field} = ? WHERE id = 1`)
      .run(field === 'read_revision' ? 2 : randomUUID());
    expect(() => listProjects(context, { all_projects: true, limit: 1, cursor })).toThrow(
      expect.objectContaining({ code: 'CURSOR_STALE' }),
    );
  });
  it('rejects malformed cursors, absent/mixed scopes and caller clock or unknown fields', () => {
    for (const cursor of ['not-json', '%%%', Buffer.from('{}').toString('base64url')]) {
      expect(() => listProjects(context, { all_projects: true, cursor })).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
    }
    for (const input of [
      {},
      { project_slug: 'alpha', all_projects: true as const },
      { all_projects: true as const, as_of: seedTime },
      { all_projects: true as const, now: seedTime },
    ])
      expect(() => listProjects(context, input)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
  });
  it('reports missing or structurally corrupt current configuration as an internal storage error', () => {
    fixture.connection.sqlite
      .prepare("UPDATE projects SET config_revision = 2 WHERE slug = 'alpha'")
      .run();
    expect(() => getProjectConfiguration(context, 'alpha')).toThrow(
      expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    );
    insertStorageRow(
      fixture.connection.sqlite,
      'project_configs',
      configRow({ project_slug: 'alpha', revision: 2, priority_model: '{}' }),
    );
    const before = snapshot();
    expect(() => getProjectConfiguration(context, 'alpha')).toThrow(
      expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    );
    expect(snapshot()).toEqual(before);
  });
  it('returns pure built-in presets for explicit scopes even before a project is created', () => {
    const before = snapshot();
    const preset = readConfigPresets(context, { project_slug: 'not-created-yet' });
    expect(preset.data.priority_models.map((model) => model.type)).toEqual([
      'classic',
      'eisenhower',
      'named',
      'numeric',
    ]);
    expect(readConfigPresets(context, { all_projects: true }).data).toEqual(preset.data);
    const extra = { all_projects: true as const, debug: true };
    expect(() => readConfigPresets(context, extra)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(snapshot()).toEqual(before);
  });
});

describe('reads after real project edits and lifecycle commands', () => {
  it('reflects edits/archive/restore while preserving ordinary children, reservations, config and rejected-batch atomicity', () => {
    const epoch = getProject(context, 'alpha').meta.database_epoch;
    createProject(context, 'epsilon', {
      operation_id: randomUUID(),
      database_epoch: epoch,
      payload: { slug: 'epsilon', name: 'Новый проект', emoji: '🧿' },
    });
    const projectReservations = fixture.connection.sqlite
      .prepare('SELECT * FROM project_emoji_reservations ORDER BY emoji_key')
      .all();
    const taskId = randomUUID();
    const archivedId = randomUUID();
    insertStorageRow(
      fixture.connection.sqlite,
      'tasks',
      taskRow({
        id: taskId,
        project_slug: 'epsilon',
        status_id: 'in_progress',
        revision: 3,
        emoji: '🛠️',
        emoji_key: '🛠',
      }),
    );
    insertStorageRow(
      fixture.connection.sqlite,
      'tasks',
      taskRow({
        id: archivedId,
        project_slug: 'epsilon',
        status_id: 'done',
        revision: 4,
        archived_at: clock.now(),
        emoji: '📬',
        emoji_key: '📬',
      }),
    );
    insertStorageRow(fixture.connection.sqlite, 'task_emoji_reservations', {
      project_slug: 'epsilon',
      task_id: taskId,
      emoji_key: '🛠',
    });
    const children = fixture.connection.sqlite
      .prepare("SELECT * FROM tasks WHERE project_slug = 'epsilon' ORDER BY id")
      .all();
    const reservations = fixture.connection.sqlite
      .prepare('SELECT * FROM task_emoji_reservations')
      .all();
    const config = getProjectConfiguration(context, 'epsilon').data;
    const cursor = firstCursor();
    clock.advanceBy(1_000);
    updateProject(context, 'epsilon', {
      operation_id: randomUUID(),
      database_epoch: epoch,
      expected_revision: 1,
      expected_config_revision: 1,
      payload: { name: 'Рабочий проект', description: '  **Сохранить исходник**  ', priority: 20 },
    });
    expect(getProject(context, 'epsilon').data).toMatchObject({
      name: 'Рабочий проект',
      description: '  **Сохранить исходник**  ',
      priority: 20,
      revision: 2,
      config_revision: 1,
      archived_at: null,
    });
    expect(listProjects(context, { all_projects: true }).data.items[0]?.slug).toBe('epsilon');
    expect(() => listProjects(context, { all_projects: true, limit: 1, cursor })).toThrow(
      expect.objectContaining({ code: 'CURSOR_STALE' }),
    );
    const affected = [
      { task_id: taskId, expected_revision: 3 },
      { task_id: archivedId, expected_revision: 4 },
    ];
    const base = { database_epoch: epoch, expected_revision: 2, expected_config_revision: 1 };
    for (const affectedTasks of [
      [{ task_id: taskId, expected_revision: 3 }],
      [
        { task_id: taskId, expected_revision: 2 },
        { task_id: archivedId, expected_revision: 4 },
      ],
    ]) {
      const before = snapshot();
      expect(() =>
        archiveProject(context, 'epsilon', {
          ...base,
          operation_id: randomUUID(),
          payload: { affected_tasks: affectedTasks },
        }),
      ).toThrow();
      expect(snapshot()).toEqual(before);
    }
    archiveProject(context, 'epsilon', {
      ...base,
      operation_id: randomUUID(),
      payload: { affected_tasks: affected },
    });
    expect(getProject(context, 'epsilon').data).toMatchObject({
      revision: 3,
      archived_at: new Date(clock.now()).toISOString(),
    });
    expect(listProjects(context, { project_slug: 'epsilon' }).data.items).toEqual([]);
    expect(
      listProjects(context, { project_slug: 'epsilon', archive: 'only' }).data.items[0]?.slug,
    ).toBe('epsilon');
    const beforeRejected = snapshot();
    expect(() =>
      updateProject(context, 'epsilon', {
        ...base,
        expected_revision: 3,
        operation_id: randomUUID(),
        payload: { name: 'Запрещено' },
      }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(() =>
      restoreProject(context, 'epsilon', {
        ...base,
        expected_revision: 3,
        operation_id: randomUUID(),
        payload: { affected_tasks: [] },
      }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(snapshot()).toEqual(beforeRejected);
    restoreProject(context, 'epsilon', {
      ...base,
      expected_revision: 3,
      operation_id: randomUUID(),
      payload: { affected_tasks: affected },
    });
    expect(getProject(context, 'epsilon').data).toMatchObject({ revision: 4, archived_at: null });
    expect(listProjects(context, { project_slug: 'epsilon' }).data.items[0]?.slug).toBe('epsilon');
    expect(getProjectConfiguration(context, 'epsilon').data).toEqual(config);
    expect(
      fixture.connection.sqlite
        .prepare("SELECT * FROM tasks WHERE project_slug = 'epsilon' ORDER BY id")
        .all(),
    ).toEqual(children);
    expect(
      fixture.connection.sqlite.prepare('SELECT * FROM task_emoji_reservations').all(),
    ).toEqual(reservations);
    expect(
      fixture.connection.sqlite
        .prepare('SELECT * FROM project_emoji_reservations ORDER BY emoji_key')
        .all(),
    ).toEqual(projectReservations);
    expect(
      fixture.connection.sqlite.prepare('SELECT count(*) FROM audit_records').pluck().get(),
    ).toBe(4);
    expect(
      fixture.connection.sqlite.prepare('SELECT count(*) FROM operation_receipts').pluck().get(),
    ).toBe(4);
  });
});
