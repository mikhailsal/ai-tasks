import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  createRecoveryFixture,
  loadRecoveryApi,
  makeBackupEnvelope,
  runRecoveryRestore,
  seedRecoveryProject,
  type RecoveryFixture,
} from '../fixtures/recovery.js';

/** Spec 011 edge case: a restore keeps worker passes valid and the project table consistent. */
let fixture: RecoveryFixture;
beforeEach(async () => {
  fixture = await createRecoveryFixture();
  await seedRecoveryProject(fixture, 'alpha', '🔵');
});
afterEach(async () => fixture?.close());

type Live = { slug: string; revision: number; config_revision: number };
const scope = (live: Live[]) =>
  live.map((project) => ({
    project_slug: project.slug,
    expected_revision: project.revision,
    expected_config_revision: project.config_revision,
  }));

/** The worker's upsert of `worker_passes`. */
const pass = (slug: string, at: number) =>
  fixture.connection.sqlite
    .prepare(
      'INSERT INTO worker_passes VALUES (?, ?) ON CONFLICT(project_slug) DO UPDATE SET last_pass_at = excluded.last_pass_at',
    )
    .run(slug, at);

it('restore keeps passes valid, also for a live-only project it removes', async () => {
  const api = await loadRecoveryApi();
  const backupTime = fixture.clock.now();
  pass('alpha', backupTime);
  const backup = await api.createBackup(fixture.context, 'alpha', makeBackupEnvelope(fixture), {
    backupDirectory: fixture.backupDirectory,
  });
  await seedRecoveryProject(fixture, 'gamma', '🟡');
  pass('alpha', backupTime + 120_000);
  pass('gamma', backupTime + 120_000);
  const live = fixture.connection.sqlite
    .prepare('SELECT slug, revision, config_revision FROM projects ORDER BY slug')
    .all() as Live[];
  await runRecoveryRestore(fixture, { backupId: backup.data.id, affectedProjects: scope(live) });
  const sqlite = fixture.connection.sqlite; // restore reopens the connection
  expect(sqlite.prepare('SELECT slug FROM projects').pluck().all()).toEqual(['alpha']);
  expect(sqlite.prepare('SELECT project_slug FROM worker_passes').pluck().all()).toEqual(['alpha']);
  expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
