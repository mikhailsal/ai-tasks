import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod/mini';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { openDatabase } from '../../src/core/database/open.js';
import { loadRecoveryApi } from '../fixtures/recovery.js';
import { prepareRecoveryScenario } from '../fixtures/recovery-scenario.js';
import { buildRecoveryDriver, startRecoveryDriver } from '../fixtures/recovery-process.js';

let compiled: Awaited<ReturnType<typeof buildRecoveryDriver>>;
const scenarios: Awaited<ReturnType<typeof prepareRecoveryScenario>>[] = [];
const children: ReturnType<typeof startRecoveryDriver>[] = [];
beforeAll(async () => {
  compiled = await buildRecoveryDriver();
});
afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => child.close()));
  await Promise.all(scenarios.splice(0).map(({ fixture }) => fixture.close()));
});
afterAll(() => compiled?.close());

function driver() {
  const child = startRecoveryDriver(compiled.entry);
  children.push(child);
  return child;
}
const phases = [
  ['stage.before_sync', false],
  ['stage.after_sync', false],
  ['recovery.after_sync', false],
  ['manifest.before_sync', false],
  ['manifest.after_sync', false],
  ['publish.before_replace', false],
  ['publish.after_replace', true],
  ['publish.before_directory_sync', true],
  ['publish.after_directory_sync', true],
  ['reopen.before_open', true],
  ['reopen.after_verify', true],
] as const;

it.each(phases)(
  'deterministically recovers a killed helper at %s without a missing live path',
  async (phase, published) => {
    const scenario = await prepareRecoveryScenario();
    scenarios.push(scenario);
    const { fixture, request, oldEpoch, originalId } = scenario;
    const inode = (await stat(`${fixture.databasePath}.lock`)).ino;
    const first = driver();
    await first.waitFor('ready');
    let missing = false;
    const watch = setInterval(() => {
      if (!existsSync(fixture.databasePath)) missing = true;
    }, 1);
    try {
      first.run({ ...request, pauseAt: phase });
      await first.waitFor('locked');
      const paused = await first.waitFor('barrier');
      expect(paused).toEqual({ type: 'barrier', name: phase });
      expect(existsSync(fixture.databasePath)).toBe(true);
      first.kill();
      expect(await first.completed).toMatchObject({ signal: 'SIGKILL' });

      // A persisted publication guard must block ordinary startup after the lock is released.
      if (existsSync(`${fixture.databasePath}.recovery.json`)) {
        const lock = acquireDatabaseLock({
          databasePath: fixture.databasePath,
          mode: 'shared',
          timeoutSeconds: 0,
        });
        try {
          expect(() => openDatabase({ path: fixture.databasePath, lock })).toThrow(
            expect.objectContaining({ code: 'MAINTENANCE' }),
          );
        } finally {
          releaseDatabaseLock(lock);
        }
      }
      const next = driver();
      await next.waitFor('ready');
      next.run({
        action: 'recover',
        databasePath: fixture.databasePath,
        backupDirectory: fixture.backupDirectory,
        now: fixture.clock.now(),
      });
      expect(await next.waitFor('result')).toEqual({ type: 'result', value: null });
      expect(await next.completed).toEqual({ code: 0, signal: null });
      expect(existsSync(`${fixture.databasePath}.recovery.json`)).toBe(false);
      fixture.reopen();
      expect(fixture.connection.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(fixture.connection.sqlite.pragma('foreign_key_check')).toEqual([]);
      expect((await stat(`${fixture.databasePath}.lock`)).ino).toBe(inode);
      const rows = z
        .array(z.object({ id: z.uuid(), title: z.string() }))
        .parse(
          fixture.connection.sqlite.prepare('SELECT id,title FROM tasks ORDER BY title').all(),
        );
      expect(rows.some((row) => row.id === originalId)).toBe(true);
      expect(rows.map((row) => row.title)).toContain('Работа из снимка');
      expect(rows.map((row) => row.title).includes('Работа после снимка')).toBe(!published);
      expect(fixture.epoch() === oldEpoch).toBe(!published);
      const api = await loadRecoveryApi();
      const status = z.object({ data: z.object({ state: z.enum(['succeeded', 'failed']) }) }).parse(
        await api.getRecoveryStatus({
          backupDirectory: fixture.backupDirectory,
          operationId: request.envelope.operation_id,
        }),
      );
      expect(status.data.state).toBe(published ? 'succeeded' : 'failed');
      const before = fixture.connection.sqlite
        .prepare('SELECT * FROM audit_records ORDER BY id')
        .all();
      fixture.closeDatabaseForRestore();
      const again = driver();
      await again.waitFor('ready');
      again.run({
        action: 'recover',
        databasePath: fixture.databasePath,
        backupDirectory: fixture.backupDirectory,
        now: fixture.clock.now(),
      });
      expect(await again.waitFor('result')).toEqual({ type: 'result', value: null });
      await again.completed;
      fixture.reopen();
      expect(
        fixture.connection.sqlite.prepare('SELECT * FROM audit_records ORDER BY id').all(),
      ).toEqual(before);
      expect(first.stderr()).toBe('');
      expect(next.stderr()).toBe('');
    } finally {
      clearInterval(watch);
      expect(missing).toBe(false);
    }
  },
);

it('keeps maintenance status readable from external receipts while the database is exclusively locked', async () => {
  const scenario = await prepareRecoveryScenario();
  scenarios.push(scenario);
  const child = driver();
  await child.waitFor('ready');
  child.run({ ...scenario.request, pauseAt: 'publish.before_replace' });
  await child.waitFor('barrier');
  const api = await loadRecoveryApi();
  const status = z.object({ data: z.object({ state: z.literal('running') }) }).parse(
    await api.getRecoveryStatus({
      backupDirectory: scenario.fixture.backupDirectory,
      operationId: scenario.request.envelope.operation_id,
    }),
  );
  expect(status.data.state).toBe('running');
  expect(() =>
    acquireDatabaseLock({
      databasePath: scenario.fixture.databasePath,
      mode: 'shared',
      timeoutSeconds: 0,
    }),
  ).toThrow(expect.objectContaining({ code: 'DB_CONFLICT' }));
  child.release();
  const result = await child.waitFor('result');
  expect(result.type).toBe('result');
  expect(await child.completed).toEqual({ code: 0, signal: null });
  scenario.fixture.reopen();
  expect(scenario.fixture.epoch()).not.toBe(scenario.oldEpoch);
});

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesIn(path) : entry.isFile() ? [path] : [];
    }),
  );
  return nested.flat();
}

it('rolls back an unverifiable published generation using its verified recovery copy and preserves damaged bytes', async () => {
  const scenario = await prepareRecoveryScenario();
  scenarios.push(scenario);
  const { fixture, request } = scenario;
  fixture.reopen();
  const before = fixture.connection.sqlite.prepare('SELECT * FROM audit_records ORDER BY id').all();
  fixture.closeDatabaseForRestore();
  const child = driver();
  await child.waitFor('ready');
  child.run({ ...request, pauseAt: 'publish.after_replace' });
  await child.waitFor('barrier');
  const damaged = await readFile(fixture.databasePath);
  damaged.fill(0, 0, 64);
  await writeFile(fixture.databasePath, damaged);
  const damagedHash = createHash('sha256').update(damaged).digest('hex');
  child.kill();
  await child.completed;
  const recovery = driver();
  await recovery.waitFor('ready');
  recovery.run({
    action: 'recover',
    databasePath: fixture.databasePath,
    backupDirectory: fixture.backupDirectory,
    now: fixture.clock.now(),
  });
  expect(await recovery.waitFor('result')).toEqual({ type: 'result', value: null });
  await recovery.completed;
  fixture.reopen();
  expect(fixture.epoch()).toBe(scenario.oldEpoch);
  expect(fixture.connection.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
  expect(
    fixture.connection.sqlite.prepare('SELECT * FROM audit_records ORDER BY id').all(),
  ).toEqual(before);
  expect(fixture.connection.sqlite.prepare('SELECT count(*) AS count FROM tasks').get()).toEqual({
    count: 2,
  });
  const preserved = await Promise.all(
    (await filesIn(fixture.directory))
      .filter((path) => path !== fixture.databasePath)
      .map(async (path) =>
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      ),
  );
  expect(preserved).toContain(damagedHash);
  const api = await loadRecoveryApi();
  expect(
    await api.getRecoveryStatus({
      backupDirectory: fixture.backupDirectory,
      operationId: request.envelope.operation_id,
    }),
  ).toMatchObject({ data: { state: 'failed' } });
});
