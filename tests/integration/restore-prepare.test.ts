import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createBackup, validateBackup } from '../../src/core/recovery/index.js';
import { openRecoveryConnection } from '../../src/core/recovery/connections.js';
import { prepareRestore } from '../../src/core/recovery/prepare.js';
import { restoreInputSchema } from '../../src/schema/recovery.js';
import { mutationEnvelopeSchema } from '../../src/schema/envelopes.js';
import { runLocked } from '../../src/runtime/locked-entry.js';
import {
  createRecoveryFixture,
  makeBackupEnvelope,
  makeRestoreEnvelope,
  seedRecoveryProject,
  seedRecoveryTask,
  type RecoveryFixture,
} from '../fixtures/recovery.js';

let fixture: RecoveryFixture;
beforeEach(async () => {
  fixture = await createRecoveryFixture();
  await seedRecoveryProject(fixture, 'alpha', '🧭');
  await seedRecoveryTask(fixture, { projectSlug: 'alpha', title: 'Original', emoji: '📌' });
});
afterEach(async () => fixture?.close());

async function proposal() {
  const backup = await createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  const validation = await validateBackup(fixture.context, backup.data.id, {
    backupDirectory: fixture.backupDirectory,
  });
  return makeRestoreEnvelope(fixture, {
    backupId: backup.data.id,
    affectedProjects: validation.data.affected_projects,
  });
}

it('prepares a closed new generation and verified old recovery copy without replacing live data', async () => {
  const envelope = await proposal();
  const oldEpoch = fixture.epoch();
  await seedRecoveryTask(fixture, { projectSlug: 'alpha', title: 'Later', emoji: '🪁' });
  fixture.closeDatabaseForRestore();
  const prepared = await runLocked(
    { databasePath: fixture.databasePath, mode: 'exclusive' },
    async (lock) => {
      const jobId = randomUUID();
      const result = await prepareRestore({
        databasePath: fixture.databasePath,
        backupDirectory: fixture.backupDirectory,
        lock,
        jobId,
        actor: fixture.actor,
        projectSlug: 'alpha',
        envelope,
        now: fixture.clock.now,
      });
      const live = openRecoveryConnection({
        databasePath: fixture.databasePath,
        lock,
        role: 'read-live',
        now: fixture.clock.now,
      });
      const stage = openRecoveryConnection({
        databasePath: fixture.databasePath,
        lock,
        role: 'stage',
        jobId,
        now: fixture.clock.now,
      });
      try {
        expect(
          live.sqlite.prepare('SELECT database_epoch FROM application_state').pluck().get(),
        ).toBe(oldEpoch);
        expect(live.sqlite.prepare('SELECT count(*) FROM tasks').pluck().get()).toBe(2);
        expect(
          stage.sqlite.prepare('SELECT database_epoch FROM application_state').pluck().get(),
        ).toBe(result.result.database_epoch);
        expect(stage.sqlite.prepare('SELECT count(*) FROM tasks').pluck().get()).toBe(1);
        expect(stage.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
        expect(result.result.database_epoch).not.toBe(oldEpoch);
        expect(result.stageChecksum).toMatch(/^[a-f0-9]{64}$/u);
      } finally {
        stage.close();
        live.close();
      }
      return result;
    },
  );
  fixture.reopen();
  expect(fixture.epoch()).toBe(oldEpoch);
  expect(
    (
      await validateBackup(fixture.context, prepared.recovery.id, {
        backupDirectory: fixture.backupDirectory,
      })
    ).data.integrity,
  ).toBe('ok');
});

it('rejects incomplete scope before creating a stage or recovery snapshot', async () => {
  const original = await proposal();
  const payload = restoreInputSchema.parse(original.payload);
  const envelope = mutationEnvelopeSchema.parse({
    ...original,
    payload: { ...payload, affected_projects: [] },
  });
  const managedBefore = await readdir(fixture.backupDirectory, { recursive: true });
  fixture.closeDatabaseForRestore();
  const before = await readFile(fixture.databasePath);
  await runLocked({ databasePath: fixture.databasePath, mode: 'exclusive' }, async (lock) => {
    await expect(
      prepareRestore({
        databasePath: fixture.databasePath,
        backupDirectory: fixture.backupDirectory,
        lock,
        jobId: randomUUID(),
        actor: fixture.actor,
        projectSlug: 'alpha',
        envelope,
        now: fixture.clock.now,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  expect(await readFile(fixture.databasePath)).toEqual(before);
  expect(await readdir(fixture.backupDirectory, { recursive: true })).toEqual(managedBefore);
  expect((await readdir(fixture.directory)).some((name) => name.includes('.restore-'))).toBe(false);
});

it('refuses semantically unreadable current audit before opening it for writes', async () => {
  const envelope = await proposal();
  // SQLite accepts JSON objects here; the public immutable audit contract requires consent fields.
  fixture.connection.sqlite
    .prepare(
      `
    INSERT INTO audit_records (id, operation_id, project_slug, entity_type, entity_id, actor,
      origin, timestamp, action, changes, config_snapshot, confirmation, database_epoch)
    SELECT ?, ?, project_slug, entity_type, entity_id, actor, origin, timestamp, action,
      changes, config_snapshot, '{}', database_epoch FROM audit_records LIMIT 1
  `,
    )
    .run(randomUUID(), randomUUID());
  const managedBefore = await readdir(fixture.backupDirectory, { recursive: true });
  fixture.closeDatabaseForRestore();
  const before = await readFile(fixture.databasePath);
  await runLocked({ databasePath: fixture.databasePath, mode: 'exclusive' }, async (lock) => {
    await expect(
      prepareRestore({
        databasePath: fixture.databasePath,
        backupDirectory: fixture.backupDirectory,
        lock,
        jobId: randomUUID(),
        actor: fixture.actor,
        projectSlug: 'alpha',
        envelope,
        now: fixture.clock.now,
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
  expect(await readFile(fixture.databasePath)).toEqual(before);
  expect(await readdir(fixture.backupDirectory, { recursive: true })).toEqual(managedBefore);
  expect((await readdir(fixture.directory)).some((name) => name.includes('.restore-'))).toBe(false);
});

it('requires an actual exclusive flock for private recovery access', async () => {
  fixture.closeDatabaseForRestore();
  await runLocked({ databasePath: fixture.databasePath, mode: 'shared' }, (lock) => {
    expect(() =>
      openRecoveryConnection({
        databasePath: fixture.databasePath,
        lock,
        role: 'read-live',
        now: fixture.clock.now,
      }),
    ).toThrow('exclusive');
    expect(() =>
      openRecoveryConnection({
        databasePath: fixture.databasePath,
        lock: { ...lock, mode: 'exclusive' },
        role: 'read-live',
        now: fixture.clock.now,
      }),
    ).toThrow('maintenance lock');
  });
});
