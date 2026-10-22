import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { updateProject } from '../../src/core/projects/commands.js';
import { z } from 'zod/mini';
import {
  createRecoveryFixture,
  loadRecoveryApi,
  makeBackupEnvelope,
  makeRestoreEnvelope,
  runRecoveryRestore,
  seedRecoveryProject,
  seedRecoveryTask,
  type RecoveryFixture,
} from '../fixtures/recovery.js';

let fixture: RecoveryFixture;
beforeEach(async () => {
  fixture = await createRecoveryFixture();
  await seedRecoveryProject(fixture, 'alpha', '🔵');
  await seedRecoveryProject(fixture, 'beta', '🟢');
  await seedRecoveryTask(fixture, {
    projectSlug: 'alpha',
    title: 'Исходная задача',
    emoji: '⚪',
    description: '**Исходник** <script>опасно</script>',
  });
});
afterEach(async () => fixture?.close());

function mutateFixtureHistory(
  names: readonly (
    | 'project_emoji_reservations_immutable_update'
    | 'project_emoji_reservations_immutable_delete'
    | 'project_configs_immutable_delete'
  )[],
  mutate: () => void,
): void {
  const sqlite = fixture.connection.sqlite;
  // These tests deliberately construct divergent historical state that normal
  // application writes must reject. Preserve the production immutability trigger
  // outside the narrow fixture mutation.
  const definitions = names.map((name) => ({
    name,
    sql: z
      .string()
      .parse(
        sqlite
          .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
          .pluck()
          .get(name),
      ),
  }));
  for (const definition of definitions) sqlite.exec(`DROP TRIGGER "${definition.name}"`);
  try {
    mutate();
  } finally {
    for (const definition of definitions) sqlite.exec(definition.sql);
  }
}

function mutateReservationFixture(mutate: () => void): void {
  mutateFixtureHistory(
    ['project_emoji_reservations_immutable_update', 'project_emoji_reservations_immutable_delete'],
    mutate,
  );
}

function currentProjects(current: RecoveryFixture) {
  const rows: unknown = current.connection.sqlite
    .prepare('SELECT slug, revision, config_revision FROM projects ORDER BY slug')
    .all();
  return z
    .array(z.strictObject({ slug: z.string(), revision: z.int(), config_revision: z.int() }))
    .parse(rows);
}

function auditIds(current: RecoveryFixture) {
  const rows: unknown = current.connection.sqlite
    .prepare('SELECT id FROM audit_records ORDER BY id')
    .all();
  return z
    .array(z.strictObject({ id: z.uuid() }))
    .parse(rows)
    .map((row) => row.id);
}

it('restores the exact live/backup project union, nullable absent-live revisions, immutable audit union, and a new epoch', async () => {
  const api = await loadRecoveryApi();
  const created = await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  const backupProjects = created.data.projects;
  const backupEpoch = fixture.epoch();

  // Exercise both sides of the union: a backup-only beta and a live-only gamma.
  mutateFixtureHistory(['project_configs_immutable_delete'], () => {
    fixture.connection.sqlite.exec(
      "DELETE FROM project_configs WHERE project_slug='beta'; DELETE FROM projects WHERE slug='beta';",
    );
  });
  updateProject(
    fixture.context,
    'alpha',
    fixture.mutation({ emoji: '🟣' }, { projectSlug: 'alpha', revision: 1 }),
  );
  const liveReservationAt = fixture.clock.now() + 100;
  mutateReservationFixture(() => {
    fixture.connection.sqlite
      .prepare(
        "UPDATE project_emoji_reservations SET first_reserved_at=? WHERE emoji_key='🔵' AND project_slug='alpha'",
      )
      .run(liveReservationAt);
  });
  fixture.connection.sqlite
    .prepare(
      'INSERT INTO project_emoji_reservations (emoji_key, project_slug, emoji, first_reserved_at) VALUES (?, ?, ?, ?)',
    )
    .run('🟠', 'historical-owner', '🟠', fixture.clock.now());
  await seedRecoveryProject(fixture, 'gamma', '🟡');
  const liveProjects = currentProjects(fixture);
  type AffectedProject = {
    project_slug: string;
    expected_revision: number | null;
    expected_config_revision: number | null;
  };
  const expected = new Map<string, AffectedProject>(
    liveProjects.map((project) => [
      project.slug,
      {
        project_slug: project.slug,
        expected_revision: project.revision,
        expected_config_revision: project.config_revision,
      },
    ]),
  );
  for (const project of backupProjects) {
    if (!expected.has(project.project_slug))
      expected.set(project.project_slug, {
        project_slug: project.project_slug,
        expected_revision: null,
        expected_config_revision: null,
      });
  }
  const scoped = [...expected.values()].sort((left, right) =>
    left.project_slug.localeCompare(right.project_slug, 'en'),
  );
  const auditUnion = auditIds(fixture);

  const restored = await runRecoveryRestore(fixture, {
    backupId: created.data.id,
    affectedProjects: scoped,
    operationId: randomUUID(),
  });
  expect(restored.affected_projects).toEqual(['alpha', 'beta', 'gamma']);
  expect(restored.database_epoch).not.toBe(backupEpoch);
  expect(fixture.epoch()).toBe(restored.database_epoch);
  expect(currentProjects(fixture).map((project) => project.slug)).toEqual(['alpha', 'beta']);
  expect(auditIds(fixture)).toEqual(expect.arrayContaining(auditUnion));
  expect(auditIds(fixture)).toHaveLength(new Set(auditIds(fixture)).size);
  expect(
    fixture.connection.sqlite
      .prepare("SELECT project_slug FROM project_emoji_reservations WHERE emoji_key='🟢'")
      .get(),
  ).toEqual({ project_slug: 'beta' });
  expect(
    fixture.connection.sqlite
      .prepare("SELECT project_slug FROM project_emoji_reservations WHERE emoji_key='🟠'")
      .get(),
  ).toEqual({ project_slug: 'historical-owner' });
  expect(
    fixture.connection.sqlite.prepare("SELECT emoji FROM projects WHERE slug='alpha'").get(),
  ).toEqual({ emoji: '🔵' });
  expect(
    fixture.connection.sqlite
      .prepare("SELECT first_reserved_at FROM project_emoji_reservations WHERE emoji_key='🔵'")
      .get(),
  ).toEqual({ first_reserved_at: liveReservationAt });
  await seedRecoveryProject(fixture, 'delta', '🟤');
  await expect(
    seedRecoveryTask(fixture, { projectSlug: 'delta', title: 'Reserved marker', emoji: '🟣' }),
  ).rejects.toMatchObject({ code: 'EMOJI_CONFLICT' });
});

it('regenerates safe rendered HTML, preserves recovery copy, and refuses an old-epoch retry', async () => {
  const taskRow: unknown = fixture.connection.sqlite
    .prepare('SELECT id FROM tasks WHERE project_slug=?')
    .get('alpha');
  const taskId = z.strictObject({ id: z.uuid() }).parse(taskRow).id;
  const cursorSecretBefore: unknown = fixture.connection.sqlite
    .prepare('SELECT secret FROM pagination_secrets WHERE id=1')
    .get();
  const api = await loadRecoveryApi();
  const backup = await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  const operationId = randomUUID();
  const projects = currentProjects(fixture).map((project) => ({
    project_slug: project.slug,
    expected_revision: project.revision,
    expected_config_revision: project.config_revision,
  }));
  const oldEpoch = fixture.epoch();
  const newCursorSecret = 'b'.repeat(64);
  const liveCompletionTime = fixture.clock.now() + 50_000;
  fixture.connection.sqlite
    .prepare('UPDATE pagination_secrets SET secret=? WHERE id=1')
    .run(newCursorSecret);
  fixture.connection.sqlite
    .prepare('UPDATE tasks SET completion_recorded_at=? WHERE id=?')
    .run(liveCompletionTime, taskId);
  const result = await runRecoveryRestore(fixture, {
    backupId: backup.data.id,
    affectedProjects: projects,
    operationId,
  });
  expect(result.recovery_snapshot_id).toEqual(expect.any(String));
  expect(
    await api.validateBackup(fixture.context, result.recovery_snapshot_id, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).toMatchObject({ data: { compatible: true, integrity: 'ok' } });
  expect(fixture.epoch()).not.toBe(oldEpoch);
  const task = fixture.connection.sqlite
    .prepare('SELECT description, description_html FROM tasks WHERE project_slug=?')
    .get('alpha');
  const restoredTask = z
    .strictObject({ description: z.string(), description_html: z.string() })
    .parse(task);
  expect(restoredTask.description).toContain('<script>');
  expect(restoredTask.description_html).not.toContain('<script>');
  expect(
    fixture.connection.sqlite.prepare('SELECT secret FROM pagination_secrets WHERE id=1').get(),
  ).toEqual({ secret: newCursorSecret });
  expect(
    fixture.connection.sqlite
      .prepare('SELECT completion_recorded_at FROM tasks WHERE id=?')
      .get(taskId),
  ).toEqual({ completion_recorded_at: liveCompletionTime });
  expect(cursorSecretBefore).toBeDefined();

  await expect(
    runRecoveryRestore(fixture, {
      backupId: backup.data.id,
      affectedProjects: projects,
      operationId,
      databaseEpoch: oldEpoch,
    }),
  ).rejects.toMatchObject({ code: 'DATABASE_EPOCH_CONFLICT' });
});

it('rejects staged task-marker collisions with exact scalar-sorted conflict details before publication', async () => {
  await seedRecoveryTask(fixture, {
    projectSlug: 'alpha',
    title: 'Task marker conflict',
    emoji: '🧩',
  });
  await seedRecoveryTask(fixture, {
    projectSlug: 'alpha',
    title: 'Second task marker conflict',
    emoji: '☀️',
  });
  const api = await loadRecoveryApi();
  const backup = await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  const taskRows: unknown = fixture.connection.sqlite
    .prepare(
      "SELECT id, emoji_key FROM tasks WHERE title LIKE '%task marker conflict' ORDER BY emoji_key",
    )
    .all();
  const markerTasks = z
    .array(z.strictObject({ id: z.uuid(), emoji_key: z.string() }))
    .parse(taskRows);
  fixture.connection.sqlite
    .prepare(
      'INSERT INTO project_emoji_reservations (emoji_key, project_slug, emoji, first_reserved_at) VALUES (?, ?, ?, ?)',
    )
    .run('🧩', 'legacy-owner', '🧩', fixture.clock.now());
  fixture.connection.sqlite
    .prepare(
      'INSERT INTO project_emoji_reservations (emoji_key, project_slug, emoji, first_reserved_at) VALUES (?, ?, ?, ?)',
    )
    .run('☀', 'legacy-owner', '☀️', fixture.clock.now());
  const scope = currentProjects(fixture).map((project) => ({
    project_slug: project.slug,
    expected_revision: project.revision,
    expected_config_revision: project.config_revision,
  }));
  const expectedConflicts = markerTasks.map((task) => ({
    reason: 'task_marker_collision',
    emoji_key: task.emoji_key,
    reservation_project_slug: 'legacy-owner',
    conflicting_project_slug: 'alpha',
    entity_id: task.id,
  }));
  await expect(
    api.validateBackup(fixture.context, backup.data.id, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).rejects.toMatchObject({ code: 'EMOJI_CONFLICT', details: { conflicts: expectedConflicts } });
  await expect(
    runRecoveryRestore(fixture, { backupId: backup.data.id, affectedProjects: scope }),
  ).rejects.toMatchObject({ code: 'EMOJI_CONFLICT', details: { conflicts: expectedConflicts } });
});

it('rejects a staged project marker reserved by a live historical owner', async () => {
  mutateReservationFixture(() => {
    fixture.connection.sqlite
      .prepare("DELETE FROM project_emoji_reservations WHERE emoji_key='🔵'")
      .run();
  });
  const api = await loadRecoveryApi();
  const backup = await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  fixture.connection.sqlite
    .prepare(
      'INSERT INTO project_emoji_reservations (emoji_key, project_slug, emoji, first_reserved_at) VALUES (?, ?, ?, ?)',
    )
    .run('🔵', 'historical-owner', '🔵', fixture.clock.now());

  const expectedConflict = {
    reason: 'project_marker_collision',
    emoji_key: '🔵',
    reservation_project_slug: 'historical-owner',
    conflicting_project_slug: 'alpha',
    entity_id: null,
  };
  await expect(
    api.validateBackup(fixture.context, backup.data.id, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).rejects.toMatchObject({ code: 'EMOJI_CONFLICT', details: { conflicts: [expectedConflict] } });
});

it('reports the same exact reservation-owner conflict in read-only validation and exclusive restore', async () => {
  const api = await loadRecoveryApi();
  const backup = await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  mutateReservationFixture(() => {
    fixture.connection.sqlite
      .prepare(
        "UPDATE project_emoji_reservations SET project_slug='historical-owner' WHERE emoji_key='🔵'",
      )
      .run();
  });
  const before = currentProjects(fixture);
  const expectedConflict = {
    reason: 'reservation_owner_mismatch',
    emoji_key: '🔵',
    reservation_project_slug: 'historical-owner',
    conflicting_project_slug: 'alpha',
    entity_id: null,
  };

  await expect(
    api.validateBackup(fixture.context, backup.data.id, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).rejects.toMatchObject({
    code: 'EMOJI_CONFLICT',
    details: { conflicts: [expectedConflict] },
  });
  await expect(
    runRecoveryRestore(fixture, {
      backupId: backup.data.id,
      affectedProjects: before.map((project) => ({
        project_slug: project.slug,
        expected_revision: project.revision,
        expected_config_revision: project.config_revision,
      })),
    }),
  ).rejects.toMatchObject({
    code: 'EMOJI_CONFLICT',
    details: { conflicts: [expectedConflict] },
  });
  expect(currentProjects(fixture)).toEqual(before);
  expect(
    fixture.connection.sqlite
      .prepare("SELECT project_slug FROM project_emoji_reservations WHERE emoji_key='🔵'")
      .get(),
  ).toEqual({ project_slug: 'historical-owner' });
});

it('refuses divergent content for a shared immutable audit UUID without replacing the live branch', async () => {
  const api = await loadRecoveryApi();
  const backup = await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  const audit = fixture.connection.sqlite
    .prepare('SELECT id FROM audit_records ORDER BY id LIMIT 1')
    .get();
  const auditId = z.strictObject({ id: z.uuid() }).parse(audit).id;
  fixture.connection.sqlite.exec('DROP TRIGGER audit_records_immutable_update');
  fixture.connection.sqlite
    .prepare("UPDATE audit_records SET action='deliberately_divergent' WHERE id=?")
    .run(auditId);
  const changedAction = fixture.connection.sqlite
    .prepare('SELECT action FROM audit_records WHERE id=?')
    .get(auditId);
  const scope = currentProjects(fixture).map((project) => ({
    project_slug: project.slug,
    expected_revision: project.revision,
    expected_config_revision: project.config_revision,
  }));

  await expect(
    runRecoveryRestore(fixture, { backupId: backup.data.id, affectedProjects: scope }),
  ).rejects.toBeDefined();
  expect(
    fixture.connection.sqlite.prepare('SELECT action FROM audit_records WHERE id=?').get(auditId),
  ).toEqual(changedAction);
  expect(currentProjects(fixture).map((project) => project.slug)).toEqual(['alpha', 'beta']);
});

it('refuses restore when current audit history is unreadable and preserves the damaged database bytes', async () => {
  const api = await loadRecoveryApi();
  const backup = await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  const scope = currentProjects(fixture).map((project) => ({
    project_slug: project.slug,
    expected_revision: project.revision,
    expected_config_revision: project.config_revision,
  }));
  const envelope = makeRestoreEnvelope(fixture, {
    backupId: backup.data.id,
    affectedProjects: scope,
  });
  fixture.connection.sqlite.exec('DROP TABLE audit_records');
  fixture.closeDatabaseForRestore();
  const damagedBytes = await readFile(fixture.databasePath);

  await expect(
    runRecoveryRestore(fixture, {
      backupId: backup.data.id,
      affectedProjects: scope,
      reopenAfter: false,
      envelope,
    }),
  ).rejects.toBeDefined();
  expect(await readFile(fixture.databasePath)).toEqual(damagedBytes);
});
