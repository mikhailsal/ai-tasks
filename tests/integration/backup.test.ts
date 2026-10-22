import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { mutationEnvelopeSchema } from '../../src/schema/envelopes.js';
import { backupEnvelopeSchema } from '../../src/schema/recovery.js';
import { z } from 'zod/mini';
import { findOperationalReceipt, readBackupManifest } from '../../src/core/recovery/manifests.js';
import {
  backupWhileWriterCommits,
  createRecoveryFixture,
  loadBackupApi,
  makeBackupEnvelope,
  seedRecoveryProject,
  seedRecoveryTask,
  type RecoveryFixture,
} from '../fixtures/recovery.js';

let fixture: RecoveryFixture;
beforeEach(async () => {
  fixture = await createRecoveryFixture();
  await seedRecoveryProject(fixture, 'alpha', '🔵');
});
afterEach(async () => fixture?.close());

function domainSnapshot(current: RecoveryFixture) {
  return Object.fromEntries(
    [
      'application_state',
      'projects',
      'project_configs',
      'tasks',
      'project_emoji_reservations',
      'task_emoji_reservations',
      'audit_records',
      'operation_receipts',
    ].map((table) => [
      table,
      current.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}

async function managedDirectorySnapshot(directory: string): Promise<string[]> {
  const entries: string[] = [];
  async function visit(path: string): Promise<void> {
    for (const name of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const child = join(path, name.name);
      if (name.isDirectory()) await visit(child);
      else {
        const bytes = await readFile(child);
        entries.push(
          `${relative(directory, child)}:${createHash('sha256').update(bytes).digest('hex')}`,
        );
      }
    }
  }
  await visit(directory);
  return entries.sort();
}

it('creates a consistent managed SQLite snapshot and external receipt without domain writes', async () => {
  const api = await loadBackupApi();
  const envelope = makeBackupEnvelope(fixture);
  const before = domainSnapshot(fixture);
  const created = await api.createBackup(fixture.context, 'alpha', envelope, {
    backupDirectory: fixture.backupDirectory,
  });

  expect(created.ok).toBe(true);
  expect(created.data).toMatchObject({
    database_epoch: fixture.epoch(),
    schema_version: 1,
    settings_revision: 1,
    projects: [{ project_slug: 'alpha', revision: 1, config_revision: 1 }],
  });
  expect(created.data.id).not.toContain('/');
  expect(created.data.checksum).toMatch(/^[a-f0-9]{64}$/u);
  expect(created.data.size_bytes).toBeGreaterThan(0);
  const manifest = await readBackupManifest(fixture.backupDirectory, created.data.id);
  const receipt = await findOperationalReceipt({
    backupDirectory: fixture.backupDirectory,
    identity: manifest.identity,
  });
  expect(receipt?.result).toEqual(created);
  expect(domainSnapshot(fixture)).toEqual(before);

  const replay = await api.createBackup(fixture.context, 'alpha', envelope, {
    backupDirectory: fixture.backupDirectory,
  });
  expect(replay).toEqual(created);
  expect(domainSnapshot(fixture)).toEqual(before);
});

it('checks the database epoch before replaying an external backup receipt', async () => {
  const api = await loadBackupApi();
  const envelope = makeBackupEnvelope(fixture);
  const created = await api.createBackup(fixture.context, 'alpha', envelope, {
    backupDirectory: fixture.backupDirectory,
  });
  fixture.connection.sqlite
    .prepare('UPDATE application_state SET database_epoch=? WHERE id=1')
    .run(randomUUID());

  await expect(
    api.createBackup(fixture.context, 'alpha', envelope, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).rejects.toMatchObject({ code: 'DATABASE_EPOCH_CONFLICT' });
  expect(created.data.id).toBeTruthy();
});

it('rejects reuse of a backup operation ID with a different request or actor', async () => {
  const api = await loadBackupApi();
  const envelope = makeBackupEnvelope(fixture);
  await api.createBackup(fixture.context, 'alpha', envelope, {
    backupDirectory: fixture.backupDirectory,
  });
  const changedPayload = mutationEnvelopeSchema.parse({ ...envelope, payload: { changed: true } });
  await expect(
    api.createBackup(fixture.context, 'alpha', changedPayload, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

  const otherActor = { ...fixture.context, actor: 'ai-cli:alpha' as const };
  await expect(
    api.createBackup(otherActor, 'alpha', envelope, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
});

it('replays the exact external result before current settings guards run', async () => {
  const api = await loadBackupApi();
  const envelope = makeBackupEnvelope(fixture);
  const created = await api.createBackup(fixture.context, 'alpha', envelope, {
    backupDirectory: fixture.backupDirectory,
  });
  const managedBeforeReplay = await managedDirectorySnapshot(fixture.backupDirectory);
  fixture.connection.sqlite
    .prepare('UPDATE application_state SET revision = revision + 1 WHERE id=1')
    .run();

  const replay = await api.createBackup(fixture.context, 'alpha', envelope, {
    backupDirectory: fixture.backupDirectory,
  });
  expect(replay).toEqual(created);
  expect(await managedDirectorySnapshot(fixture.backupDirectory)).toEqual(managedBeforeReplay);
});

it('lists opaque backups with bounded cursor pages and validates checksum, schema, integrity, and affected scope', async () => {
  const api = await loadBackupApi();
  const first = await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  fixture.clock.advanceBy(1_000);
  const second = await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  const managedBeforeReads = await managedDirectorySnapshot(fixture.backupDirectory);

  const page = await api.listBackups(
    fixture.context,
    { all_projects: true, limit: 1 },
    { backupDirectory: fixture.backupDirectory },
  );
  expect(page.data.items).toHaveLength(1);
  expect(page.data.items[0]?.id).toBe(second.data.id);
  expect(page.data.next_cursor).toEqual(expect.any(String));
  const next = await api.listBackups(
    fixture.context,
    {
      all_projects: true,
      limit: 1,
      ...(page.data.next_cursor === null ? {} : { cursor: page.data.next_cursor }),
    },
    { backupDirectory: fixture.backupDirectory },
  );
  expect(next.data.items.map((item) => item.id)).toEqual([first.data.id]);

  const validated = await api.validateBackup(fixture.context, first.data.id, {
    backupDirectory: fixture.backupDirectory,
  });
  expect(validated.data).toMatchObject({
    backup: first.data,
    compatible: true,
    integrity: 'ok',
    affected_projects: [
      { project_slug: 'alpha', expected_revision: 1, expected_config_revision: 1 },
    ],
  });
  expect(await managedDirectorySnapshot(fixture.backupDirectory)).toEqual(managedBeforeReads);

  const staleCursor = page.data.next_cursor;
  fixture.clock.advanceBy(1_000);
  await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  await expect(
    api.listBackups(
      fixture.context,
      {
        all_projects: true,
        limit: 1,
        ...(staleCursor === null ? {} : { cursor: staleCursor }),
      },
      { backupDirectory: fixture.backupDirectory },
    ),
  ).rejects.toMatchObject({ code: 'CURSOR_STALE' });
});

it('rejects a staged task marker that matches a project reservation, including its owner project', async () => {
  const api = await loadBackupApi();
  await seedRecoveryTask(fixture, {
    projectSlug: 'alpha',
    title: 'Uses later reservation',
    emoji: '🟢',
  });
  const created = await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  fixture.connection.sqlite
    .prepare(
      `INSERT INTO project_emoji_reservations (emoji_key, project_slug, emoji, first_reserved_at)
       VALUES ('🟢', 'alpha', '🟢', 1792576800123)`,
    )
    .run();

  await expect(
    api.validateBackup(fixture.context, created.data.id, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).rejects.toMatchObject({
    code: 'EMOJI_CONFLICT',
    details: {
      conflicts: [
        {
          reason: 'task_marker_collision',
          emoji_key: '🟢',
          reservation_project_slug: 'alpha',
          conflicting_project_slug: 'alpha',
        },
      ],
    },
  });
});

it('takes a valid SQLite snapshot while an independent lock-holding writer commits', async () => {
  const api = await loadBackupApi();
  const result = await backupWhileWriterCommits(fixture, () =>
    api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
      backupDirectory: fixture.backupDirectory,
    }),
  );
  const backup = backupEnvelopeSchema.parse(result).data;
  const validation = await api.validateBackup(fixture.context, backup.id, {
    backupDirectory: fixture.backupDirectory,
  });
  expect(validation.data.integrity).toBe('ok');
  expect(validation.data.backup.id).toBe(backup.id);
  const state: unknown = fixture.connection.sqlite
    .prepare('SELECT read_revision FROM application_state WHERE id=1')
    .get();
  expect(z.strictObject({ read_revision: z.int() }).parse(state).read_revision).toBeGreaterThan(1);
});
