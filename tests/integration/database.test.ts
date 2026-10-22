import { randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { link, stat, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, verifySqliteVersion } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createTestClock } from '../fixtures/clock.js';
import { createDatabaseFixture, type DatabaseFixture } from '../fixtures/database.js';
import {
  auditRow,
  configRow,
  generationRow,
  insertStorageRow,
  occurrenceRow,
  projectRow,
  receiptRow,
  seedProject,
  seedTime,
  taskRow,
} from '../fixtures/storage-seed.js';

const dependencies = { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock };
const fixtures: DatabaseFixture[] = [];

async function database() {
  const fixture = await createDatabaseFixture(dependencies, createTestClock(seedTime));
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe('production schema v1 on real migrated file databases', () => {
  it('initializes exactly one settings row and a UUID epoch, and rerunning migrations preserves it', async () => {
    const { path, connection } = await database();
    expect((await stat(path)).isFile()).toBe(true);
    const initial = connection.sqlite.prepare('SELECT * FROM application_state').all();
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      database_epoch: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
      ),
      timezone: 'Europe/Moscow',
      revision: 1,
      read_revision: 1,
      schema_version: 1,
      created_at: seedTime,
      updated_at: seedTime,
    });
    migrateDatabase(connection);
    expect(connection.sqlite.prepare('SELECT * FROM application_state').all()).toEqual(initial);
    expect(connection.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(connection.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('configures native SQLite WAL/NORMAL, foreign keys and a 5000 ms busy timeout', async () => {
    const { connection } = await database();
    expect(connection.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(connection.sqlite.pragma('synchronous', { simple: true })).toBe(1);
    expect(connection.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(connection.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    const version = connection.sqlite.prepare('SELECT sqlite_version() AS version').get() as {
      version: string;
    };
    expect(() => verifySqliteVersion(version.version)).not.toThrow();
  });

  it.each(['3.50.4', '3.51.0', '3.51.2', '3.9.0', '', '3.51', 'invalid'])(
    'refuses unsupported or malformed SQLite version %j',
    (version) => {
      expect(() => verifySqliteVersion(version)).toThrow();
    },
  );

  it.each(['3.51.3', '3.51.10', '3.52.0', '4.0.0'])(
    'accepts compatible SQLite version %s using numeric comparison',
    (version) => {
      expect(() => verifySqliteVersion(version)).not.toThrow();
    },
  );

  it('reopens persisted source, rendered HTML, exact numeric thousandths, settings and history with all connection pragmas', async () => {
    const fixture = await database();
    seedProject(fixture.connection.sqlite);
    const task = taskRow({
      priority: '{"model":"numeric","value":-1000000000}',
      priority_scaled: -1_000_000_000_000,
    });
    insertStorageRow(fixture.connection.sqlite, 'tasks', task);
    const audit = auditRow();
    insertStorageRow(fixture.connection.sqlite, 'audit_records', audit);
    const settings = fixture.connection.sqlite.prepare('SELECT * FROM application_state').all();
    fixture.connection.close();
    const lock = acquireDatabaseLock({ databasePath: fixture.path, mode: 'shared' });
    const reopened = openDatabase({ path: fixture.path, lock, now: () => seedTime + 86_400_000 });
    try {
      migrateDatabase(reopened);
      expect(reopened.sqlite.prepare('SELECT * FROM application_state').all()).toEqual(settings);
      expect(
        reopened.sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id),
      ).toMatchObject(task);
      expect(
        reopened.sqlite.prepare('SELECT * FROM audit_records WHERE id = ?').get(audit.id),
      ).toEqual(audit);
      expect(reopened.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(reopened.sqlite.pragma('synchronous', { simple: true })).toBe(1);
      expect(reopened.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(reopened.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    } finally {
      reopened.close();
      releaseDatabaseLock(lock);
    }
  });

  it.each([
    { id: 'not-a-uuid' },
    { id: '12345678-1234-4123-8123-123456789abc\u0000suffix' },
    { revision: 0 },
    { revision: -1 },
    { revision: 1.5 },
    { priority: 2_147_483_648 },
    { priority: -2_147_483_649 },
    { priority: null },
    { slug: 'Uppercase' },
    { slug: 'alpha\u0000INVALID' },
    { slug: 'bad--slug' },
    { slug: 'a'.repeat(65) },
  ])('rejects invalid project storage values %j without changing rows', async (invalid) => {
    const { connection } = await database();
    expect(() => insertStorageRow(connection.sqlite, 'projects', projectRow(invalid))).toThrow();
    expect(connection.sqlite.prepare('SELECT * FROM projects').all()).toEqual([]);
  });

  it('enforces unique immutable project slugs and signed integer priority default zero', async () => {
    const { connection } = await database();
    const row = projectRow();
    delete row.priority;
    insertStorageRow(connection.sqlite, 'projects', row);
    expect(connection.sqlite.prepare('SELECT priority FROM projects').get()).toEqual({
      priority: 0,
    });
    expect(() => insertStorageRow(connection.sqlite, 'projects', projectRow())).toThrow();
    expect(() =>
      connection.sqlite
        .prepare('UPDATE projects SET slug = ? WHERE slug = ?')
        .run('renamed', 'alpha'),
    ).toThrow();
    expect(connection.sqlite.prepare('SELECT slug FROM projects').all()).toEqual([
      { slug: 'alpha' },
    ]);
  });

  it.each([
    { id: 'invalid' },
    { project_slug: 'missing' },
    { kind: 'unknown' },
    { status_id: 'idea\u0000INVALID' },
    { revision: 0 },
    { revision: 1.5 },
    { priority: '{broken' },
    { priority_scaled: 1.5 },
    { priority_scaled: 1_000_000_000_001 },
    { priority_scaled: -1_000_000_000_001 },
    { kind: 'recurring', deadline: seedTime },
  ])(
    'enforces task UUID, FK, enum, revision, JSON, exact scaled bounds and recurring deadline checks %j',
    async (invalid) => {
      const { connection } = await database();
      seedProject(connection.sqlite);
      expect(() => insertStorageRow(connection.sqlite, 'tasks', taskRow(invalid))).toThrow();
      expect(connection.sqlite.prepare('SELECT * FROM tasks').all()).toEqual([]);
    },
  );

  it('enforces composite endpoint ownership, dependency uniqueness and self-link rejection', async () => {
    const { connection } = await database();
    seedProject(connection.sqlite);
    seedProject(connection.sqlite, 'beta');
    const first = randomUUID();
    const second = randomUUID();
    insertStorageRow(connection.sqlite, 'tasks', taskRow({ id: first }));
    insertStorageRow(connection.sqlite, 'tasks', taskRow({ id: second, project_slug: 'beta' }));
    const edge = {
      dependent_task_id: first,
      dependent_project_slug: 'alpha',
      prerequisite_task_id: second,
      prerequisite_project_slug: 'beta',
      created_at: seedTime,
      created_operation_id: randomUUID(),
    };
    expect(() =>
      insertStorageRow(connection.sqlite, 'task_dependencies', {
        ...edge,
        prerequisite_project_slug: 'alpha',
      }),
    ).toThrow();
    expect(() =>
      insertStorageRow(connection.sqlite, 'task_dependencies', {
        ...edge,
        prerequisite_task_id: first,
        prerequisite_project_slug: 'alpha',
      }),
    ).toThrow();
    insertStorageRow(connection.sqlite, 'task_dependencies', edge);
    expect(() => insertStorageRow(connection.sqlite, 'task_dependencies', edge)).toThrow();
    expect(connection.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});

describe('immutable storage and migration indexes', () => {
  it('retains immutable config version bytes and validates JSON and version uniqueness', async () => {
    const { connection } = await database();
    seedProject(connection.sqlite);
    const old = connection.sqlite.prepare('SELECT * FROM project_configs').all();
    expect(() => insertStorageRow(connection.sqlite, 'project_configs', configRow())).toThrow();
    for (const field of [
      'priority_model',
      'ordinary_workflow',
      'recurring_workflow',
      'semantic_snapshot',
    ]) {
      expect(() =>
        insertStorageRow(
          connection.sqlite,
          'project_configs',
          configRow({ revision: 2, [field]: '{broken' }),
        ),
      ).toThrow();
    }
    expect(() =>
      connection.sqlite.prepare('UPDATE project_configs SET semantic_snapshot = ?').run('{}'),
    ).toThrow();
    expect(() => connection.sqlite.prepare('DELETE FROM project_configs').run()).toThrow();
    insertStorageRow(
      connection.sqlite,
      'project_configs',
      configRow({ revision: 2, semantic_snapshot: '{"label":"Новое имя"}' }),
    );
    expect(
      connection.sqlite.prepare('SELECT * FROM project_configs WHERE revision = 1').all(),
    ).toEqual(old);
  });

  it('keeps audit semantic/confirmation snapshots immutable and independent of absent live entities/projects', async () => {
    const { connection } = await database();
    const audit = auditRow();
    insertStorageRow(connection.sqlite, 'audit_records', audit);
    expect(connection.sqlite.prepare('SELECT * FROM projects').all()).toEqual([]);
    expect(connection.sqlite.pragma('foreign_key_list(audit_records)')).toEqual([]);
    expect(() => insertStorageRow(connection.sqlite, 'audit_records', audit)).toThrow();
    expect(() =>
      connection.sqlite
        .prepare('UPDATE audit_records SET changes = ? WHERE id = ?')
        .run('[]', audit.id),
    ).toThrow();
    expect(() =>
      connection.sqlite.prepare('DELETE FROM audit_records WHERE id = ?').run(audit.id),
    ).toThrow();
    expect(connection.sqlite.prepare('SELECT * FROM audit_records').all()).toEqual([audit]);
    for (const field of ['changes', 'config_snapshot', 'confirmation']) {
      expect(() =>
        insertStorageRow(connection.sqlite, 'audit_records', auditRow({ [field]: '{broken' })),
      ).toThrow();
    }
    expect(() =>
      insertStorageRow(connection.sqlite, 'audit_records', auditRow({ id: 'invalid' })),
    ).toThrow();
  });

  it('preserves permanent project markers with historical absent owners and rejects reassignment/deletion/default markers', async () => {
    const { connection } = await database();
    const reservation = {
      emoji_key: '🛰',
      emoji: '🛰️',
      project_slug: 'former-owner',
      first_reserved_at: seedTime,
    };
    insertStorageRow(connection.sqlite, 'project_emoji_reservations', reservation);
    expect(connection.sqlite.pragma('foreign_key_list(project_emoji_reservations)')).toEqual([]);
    expect(() =>
      insertStorageRow(connection.sqlite, 'project_emoji_reservations', {
        ...reservation,
        project_slug: 'another-owner',
      }),
    ).toThrow();
    expect(() =>
      connection.sqlite
        .prepare('UPDATE project_emoji_reservations SET project_slug = ?')
        .run('another-owner'),
    ).toThrow();
    expect(() =>
      connection.sqlite.prepare('DELETE FROM project_emoji_reservations').run(),
    ).toThrow();
    expect(() =>
      insertStorageRow(connection.sqlite, 'project_emoji_reservations', {
        ...reservation,
        emoji_key: '⚪',
        emoji: '⚪',
      }),
    ).toThrow();
    expect(connection.sqlite.prepare('SELECT * FROM project_emoji_reservations').all()).toEqual([
      reservation,
    ]);
    expect(connection.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('enforces receipt epoch/operation uniqueness while preserving original immutable result bytes across epochs', async () => {
    const { connection } = await database();
    const receipt = receiptRow();
    insertStorageRow(connection.sqlite, 'operation_receipts', receipt);
    expect(() => insertStorageRow(connection.sqlite, 'operation_receipts', receipt)).toThrow();
    insertStorageRow(connection.sqlite, 'operation_receipts', {
      ...receipt,
      database_epoch: randomUUID(),
    });
    expect(() =>
      connection.sqlite.prepare('UPDATE operation_receipts SET result = ?').run('{}'),
    ).toThrow();
    expect(() => connection.sqlite.prepare('DELETE FROM operation_receipts').run()).toThrow();
    for (const field of ['result', 'audit_ids']) {
      expect(() =>
        insertStorageRow(
          connection.sqlite,
          'operation_receipts',
          receiptRow({ [field]: 'broken' }),
        ),
      ).toThrow();
    }
    expect(
      connection.sqlite
        .prepare('SELECT * FROM operation_receipts WHERE database_epoch = ?')
        .get(receipt.database_epoch),
    ).toEqual(receipt);
    expect(
      connection.sqlite.prepare('SELECT count(*) AS count FROM operation_receipts').get(),
    ).toEqual({ count: 2 });
  });

  it('creates ownership, query, history, recurrence and uniqueness indexes without scheduled_for storage', async () => {
    const { connection } = await database();
    const sqlite = connection.sqlite;
    const prefixes: Record<string, string[][]> = {
      projects: [['slug'], ['priority', 'slug']],
      tasks: [
        ['project_slug', 'id'],
        ['project_slug', 'kind', 'archived_at', 'status_id', 'deadline', 'created_at', 'id'],
        ['project_slug', 'emoji_key'],
        ['emoji_key'],
      ],
      task_dependencies: [['prerequisite_task_id', 'dependent_task_id']],
      occurrences: [
        ['generation_id', 'occurrence_key'],
        ['task_id', 'state', 'deadline', 'id'],
        ['state', 'deadline', 'id'],
      ],
      recurrence_state: [['next_candidate_at']],
      audit_records: [['project_slug', 'timestamp', 'id'], ['operation_id']],
      operation_receipts: [['database_epoch', 'operation_id']],
    };
    for (const [table, expectedPrefixes] of Object.entries(prefixes)) {
      const indexes = sqlite.pragma(`index_list("${table}")`) as { name: string }[];
      const columns = indexes.map(({ name }) =>
        (sqlite.pragma(`index_info("${name}")`) as { name: string | null }[]).map(
          (column) => column.name,
        ),
      );
      for (const prefix of expectedPrefixes) {
        expect(
          columns.some((actual) => prefix.every((column, index) => actual[index] === column)),
          `${table} index prefix ${prefix.join(',')}`,
        ).toBe(true);
      }
    }
    for (const table of ['tasks', 'occurrences', 'schedule_generations', 'recurrence_state']) {
      const columns = sqlite.pragma(`table_info("${table}")`) as { name: string }[];
      expect(columns.map(({ name }) => name)).not.toContain('scheduled_for');
    }
    const ddl = sqlite
      .prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'occurrences'")
      .all() as { sql: string | null }[];
    expect(
      ddl.some(({ sql }) =>
        /expires_at|deadline\s*\+\s*(?:window_ms|confirmation_window_ms)/iu.test(sql ?? ''),
      ),
    ).toBe(true);
  });
});

describe('recurrence schema constraints and frozen snapshots', () => {
  it.each(['pending', 'completed', 'cancelled'])(
    'rejects a missed_at timestamp on %s outcome',
    async (state) => {
      const { connection } = await database();
      seedProject(connection.sqlite);
      const taskId = randomUUID();
      const generationId = randomUUID();
      insertStorageRow(
        connection.sqlite,
        'tasks',
        taskRow({ id: taskId, kind: 'recurring', status_id: 'draft' }),
      );
      insertStorageRow(
        connection.sqlite,
        'schedule_generations',
        generationRow({ id: generationId, task_id: taskId }),
      );
      expect(() =>
        insertStorageRow(
          connection.sqlite,
          'occurrences',
          occurrenceRow({
            task_id: taskId,
            generation_id: generationId,
            state,
            missed_at: seedTime,
            actual_completed_at: state === 'completed' ? seedTime : null,
            completion_recorded_at: state === 'completed' ? seedTime : null,
            cancelled_at: state === 'cancelled' ? seedTime : null,
            cancel_reason: state === 'cancelled' ? 'Отмена' : null,
          }),
        ),
      ).toThrow();
    },
  );

  it('enforces generation/anchor uniqueness, owned FKs, checked state/JSON/revision/window and immutable snapshot bytes', async () => {
    const { connection } = await database();
    const sqlite = connection.sqlite;
    seedProject(sqlite);
    const taskId = randomUUID();
    const generationId = randomUUID();
    insertStorageRow(
      sqlite,
      'tasks',
      taskRow({ id: taskId, kind: 'recurring', status_id: 'draft' }),
    );
    const generation = generationRow({ id: generationId, task_id: taskId });
    insertStorageRow(sqlite, 'schedule_generations', generation);
    for (const invalid of [
      { id: 'invalid', generation_number: 2 },
      { generation_number: 0 },
      { generation_number: 1.5 },
      { generation_number: 2, mode: 'unknown' },
      { generation_number: 2, schedule: '{broken' },
      { generation_number: 2, miss_policy: 'unknown' },
      { generation_number: 2, window_ms: -1 },
      { generation_number: 2, window_ms: 2_592_000_001 },
      { generation_number: 2, project_slug: 'missing' },
    ]) {
      expect(() =>
        insertStorageRow(
          sqlite,
          'schedule_generations',
          generationRow({ task_id: taskId, ...invalid }),
        ),
      ).toThrow();
    }
    expect(() =>
      insertStorageRow(sqlite, 'schedule_generations', { ...generation, id: randomUUID() }),
    ).toThrow();
    const occurrence = occurrenceRow({ task_id: taskId, generation_id: generationId });
    insertStorageRow(sqlite, 'occurrences', occurrence);
    expect(() =>
      insertStorageRow(sqlite, 'occurrences', { ...occurrence, id: randomUUID() }),
    ).toThrow();
    const invalidOccurrences = [
      { id: 'invalid' },
      { state: 'unknown' },
      { revision: 0 },
      { revision: 1.5 },
      { schedule_snapshot: '{broken' },
      { miss_policy: 'unknown' },
      { confirmation_window_ms: -1 },
      { confirmation_window_ms: 2_592_000_001 },
      { project_slug: 'missing' },
      { task_id: randomUUID() },
      { generation_id: randomUUID() },
    ];
    for (const [index, invalid] of invalidOccurrences.entries()) {
      expect(() =>
        insertStorageRow(
          sqlite,
          'occurrences',
          occurrenceRow({
            task_id: taskId,
            generation_id: generationId,
            occurrence_key: `calendar:${seedTime + index + 1}`,
            ...invalid,
          }),
        ),
      ).toThrow();
    }
    for (const [index, state] of [
      'completed',
      'completed_late',
      'debt',
      'missed',
      'cancelled',
    ].entries()) {
      const terminal = state === 'completed' || state === 'completed_late';
      const cancelled = state === 'cancelled';
      insertStorageRow(
        sqlite,
        'occurrences',
        occurrenceRow({
          task_id: taskId,
          generation_id: generationId,
          occurrence_key: `calendar:${seedTime + index + 100}`,
          state,
          actual_completed_at: terminal ? seedTime : null,
          completion_recorded_at: terminal ? seedTime + (state === 'completed_late' ? 1 : 0) : null,
          missed_at: ['completed_late', 'debt', 'missed'].includes(state) ? seedTime : null,
          cancelled_at: cancelled ? seedTime : null,
          cancel_reason: cancelled ? 'Отмена' : null,
        }),
      );
    }
    // Each alternate value is otherwise valid; coordinated expiry updates isolate triggers.
    for (const replacement of [
      {
        schedule_snapshot:
          '{"mode":"calendar","pattern":"days","every":2,"local_time":"00:00:00.000"}',
      },
      { description_snapshot: 'Новый исходник' },
      { miss_policy: 'record_miss' },
      { confirmation_window_ms: 1, expires_at: seedTime + 1 },
      { deadline: seedTime + 1, expires_at: seedTime + 1 },
    ]) {
      expect(() =>
        sqlite
          .prepare(
            `UPDATE occurrences SET ${Object.keys(replacement)
              .map((field) => `"${field}" = ?`)
              .join(',')} WHERE id = ?`,
          )
          .run(...Object.values(replacement), occurrence.id),
      ).toThrow();
    }
    for (const [field, value] of Object.entries({
      schedule: '{"mode":"calendar","pattern":"days","every":2,"local_time":"00:00:00.000"}',
      timezone: 'UTC',
      mode: 'after_completion',
      window_ms: 1,
      first_deadline: seedTime + 1,
    })) {
      expect(() =>
        sqlite
          .prepare(`UPDATE schedule_generations SET "${field}" = ? WHERE id = ?`)
          .run(value, generationId),
      ).toThrow();
    }
    expect(
      sqlite.prepare('SELECT * FROM schedule_generations WHERE id = ?').get(generationId),
    ).toMatchObject(generation);
    expect(
      sqlite.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id),
    ).toMatchObject(occurrence);
    // T026 policy upgrades rebuild derived HTML while immutable raw/rule snapshots survive.
    sqlite
      .prepare(
        'UPDATE occurrences SET description_html_snapshot = ?, render_policy_version = ? WHERE id = ?',
      )
      .run('<p>Обновлённое безопасное представление</p>', 2, occurrence.id);
    expect(
      sqlite.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id),
    ).toMatchObject({
      ...occurrence,
      description_html_snapshot: '<p>Обновлённое безопасное представление</p>',
      render_policy_version: 2,
    });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});

describe('production connection lock and recovery guards', () => {
  it('rejects a regular lockfile descriptor without an actual flock and rejects released tokens', async () => {
    const fixture = await database();
    const lockPath = `${fixture.path}.lock`;
    const fd = openSync(lockPath, 'r+');
    try {
      expect(() =>
        openDatabase({
          path: fixture.path,
          lock: { databasePath: fixture.path, lockPath, fd, mode: 'shared' },
        }),
      ).toThrow('held database maintenance lock');
    } finally {
      closeSync(fd);
    }
    const released = acquireDatabaseLock({ databasePath: fixture.path, mode: 'shared' });
    releaseDatabaseLock(released);
    expect(() => openDatabase({ path: fixture.path, lock: released })).toThrow(
      'held database maintenance lock',
    );
  });

  it('rejects a held lock token for another database and hard links created after acquisition', async () => {
    const fixture = await database();
    const lock = acquireDatabaseLock({ databasePath: fixture.path, mode: 'shared' });
    try {
      expect(() => openDatabase({ path: `${fixture.directory}/other.sqlite`, lock })).toThrow(
        'held database maintenance lock',
      );
      await link(fixture.path, `${fixture.directory}/alias.sqlite`);
      expect(() => openDatabase({ path: fixture.path, lock })).toThrow(
        'held database maintenance lock',
      );
    } finally {
      releaseDatabaseLock(lock);
    }
  });

  it('refuses unresolved or malformed external recovery manifests with MAINTENANCE before opening', async () => {
    const fixture = await database();
    const lock = acquireDatabaseLock({ databasePath: fixture.path, mode: 'shared' });
    try {
      for (const manifest of ['{"phase":"publishing"}', '{broken']) {
        await writeFile(`${fixture.path}.recovery.json`, manifest);
        expect(() => openDatabase({ path: fixture.path, lock })).toThrow(
          expect.objectContaining({ code: 'MAINTENANCE' }),
        );
      }
    } finally {
      releaseDatabaseLock(lock);
    }
  });
});
