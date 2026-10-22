import { access, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { backupSnapshotPath, readBackupManifest } from '../../src/core/recovery/manifests.js';
import {
  createRecoveryFixture,
  loadBackupApi,
  makeBackupEnvelope,
  seedRecoveryProject,
  type BackupApi,
  type RecoveryFixture,
} from '../fixtures/recovery.js';

let fixture: RecoveryFixture;
let api: BackupApi;
beforeEach(async () => {
  fixture = await createRecoveryFixture();
  await seedRecoveryProject(fixture, 'alpha', '🔵');
  api = await loadBackupApi();
});
afterEach(async () => fixture?.close());

async function createBackup() {
  return api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
}

it('refuses a modified snapshot checksum without changing live data or the artifact further', async () => {
  const backup = await createBackup();
  const path = backupSnapshotPath({
    backupDirectory: fixture.backupDirectory,
    backupId: backup.data.id,
  });
  const bytes = await readFile(path);
  const modified = Buffer.from(bytes);
  modified[modified.length - 1] = (modified[modified.length - 1] ?? 0) ^ 1;
  await writeFile(path, modified);
  const currentBytes = await readFile(path);
  const liveProjects = fixture.connection.sqlite
    .prepare('SELECT * FROM projects ORDER BY slug')
    .all();

  await expect(
    api.validateBackup(fixture.context, backup.data.id, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(await readFile(path)).toEqual(currentBytes);
  expect(fixture.connection.sqlite.prepare('SELECT * FROM projects ORDER BY slug').all()).toEqual(
    liveProjects,
  );
});

it('rejects valid-shaped manifest metadata that disagrees with the SQLite snapshot', async () => {
  const backup = await createBackup();
  const snapshotPath = backupSnapshotPath({
    backupDirectory: fixture.backupDirectory,
    backupId: backup.data.id,
  });
  const snapshot = new Database(snapshotPath);
  try {
    snapshot.prepare('UPDATE application_state SET database_epoch=? WHERE id=1').run(randomUUID());
  } finally {
    snapshot.close();
  }
  const manifest = await readBackupManifest(fixture.backupDirectory, backup.data.id);
  const checksum = createHash('sha256')
    .update(await readFile(snapshotPath))
    .digest('hex');
  const altered = {
    ...manifest,
    result: {
      ...manifest.result,
      data: {
        ...manifest.result.data,
        checksum,
      },
    },
  };
  await writeFile(
    join(fixture.backupDirectory, 'snapshots', `${backup.data.id}.json`),
    `${JSON.stringify(altered)}\n`,
  );
  const receiptPath = join(
    fixture.backupDirectory,
    'receipts',
    manifest.identity.database_epoch,
    `${manifest.identity.operation_id}.json`,
  );
  await writeFile(receiptPath, `${JSON.stringify(altered)}\n`);

  await expect(
    api.validateBackup(fixture.context, backup.data.id, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});

it('rejects unreadable confirmation JSON even when the snapshot checksum and SQLite integrity pass', async () => {
  const backup = await createBackup();
  const snapshotPath = backupSnapshotPath({
    backupDirectory: fixture.backupDirectory,
    backupId: backup.data.id,
  });
  const snapshot = new Database(snapshotPath);
  try {
    snapshot
      .prepare(
        "INSERT INTO audit_records (id, operation_id, project_slug, entity_type, entity_id, actor, origin, timestamp, action, changes, config_snapshot, confirmation, database_epoch) VALUES (?, ?, 'alpha', 'task', ?, 'human-web', 'web', ?, 'task.update', '[]', NULL, '{}', ?)",
      )
      .run(
        randomUUID(),
        randomUUID(),
        randomUUID(),
        fixture.clock.now(),
        backup.data.database_epoch,
      );
  } finally {
    snapshot.close();
  }

  const manifest = await readBackupManifest(fixture.backupDirectory, backup.data.id);
  const checksum = createHash('sha256')
    .update(await readFile(snapshotPath))
    .digest('hex');
  const updated = {
    ...manifest,
    result: {
      ...manifest.result,
      data: { ...manifest.result.data, checksum },
    },
  };
  const manifestPath = join(fixture.backupDirectory, 'snapshots', `${backup.data.id}.json`);
  const receiptPath = join(
    fixture.backupDirectory,
    'receipts',
    manifest.identity.database_epoch,
    `${manifest.identity.operation_id}.json`,
  );
  await writeFile(manifestPath, `${JSON.stringify(updated)}\n`);
  await writeFile(receiptPath, `${JSON.stringify(updated)}\n`);

  const snapshotBytes = await readFile(snapshotPath);
  const liveAuditCount = fixture.connection.sqlite
    .prepare('SELECT COUNT(*) AS count FROM audit_records')
    .pluck()
    .get();
  await expect(
    api.validateBackup(fixture.context, backup.data.id, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  expect(await readFile(snapshotPath)).toEqual(snapshotBytes);
  expect(
    fixture.connection.sqlite.prepare('SELECT COUNT(*) AS count FROM audit_records').pluck().get(),
  ).toBe(liveAuditCount);
});

it('rejects manifest schema mismatch before opening a snapshot', async () => {
  const backup = await createBackup();
  const manifestPath = join(fixture.backupDirectory, 'snapshots', `${backup.data.id}.json`);
  const manifest = await readBackupManifest(fixture.backupDirectory, backup.data.id);
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, version: 2 })}\n`);

  await expect(
    api.validateBackup(fixture.context, backup.data.id, {
      backupDirectory: fixture.backupDirectory,
    }),
  ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
});

it('refuses symlinked managed snapshot files without exposing storage paths', async () => {
  const backup = await createBackup();
  const path = backupSnapshotPath({
    backupDirectory: fixture.backupDirectory,
    backupId: backup.data.id,
  });
  const outside = join(fixture.directory, 'outside.sqlite');
  await writeFile(outside, 'private sentinel');
  await rm(path);
  await symlink(outside, path);

  try {
    await api.validateBackup(fixture.context, backup.data.id, {
      backupDirectory: fixture.backupDirectory,
    });
    expect.fail('symlinked snapshot should be rejected');
  } catch (error) {
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(String(error)).not.toContain(fixture.directory);
    expect(String(error)).not.toContain('private sentinel');
  }
  expect(await readFile(outside, 'utf8')).toBe('private sentinel');
});

it('returns an empty default catalog without creating recovery directories', async () => {
  await rm(fixture.backupDirectory, { recursive: true, force: true });
  const listed = await api.listBackups(fixture.context, { all_projects: true });
  expect(listed.data).toEqual({ items: [], next_cursor: null });
  await expect(access(fixture.backupDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects a cursor after its catalog context changes', async () => {
  const first = await createBackup();
  fixture.clock.advanceBy(1_000);
  await createBackup();
  const page = await api.listBackups(
    fixture.context,
    { all_projects: true, limit: 1 },
    { backupDirectory: fixture.backupDirectory },
  );
  expect(page.data.items[0]?.id).not.toBe(first.data.id);
  fixture.clock.advanceBy(1_000);
  await createBackup();

  await expect(
    api.listBackups(
      fixture.context,
      {
        all_projects: true,
        limit: 1,
        ...(page.data.next_cursor === null ? {} : { cursor: page.data.next_cursor }),
      },
      { backupDirectory: fixture.backupDirectory },
    ),
  ).rejects.toMatchObject({ code: 'CURSOR_STALE' });
});
