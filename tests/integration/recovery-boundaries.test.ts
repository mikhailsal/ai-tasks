import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod/mini';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';
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

function request(scenario: Awaited<ReturnType<typeof prepareRecoveryScenario>>) {
  return {
    action: 'recover' as const,
    databasePath: scenario.fixture.databasePath,
    backupDirectory: scenario.fixture.backupDirectory,
    now: scenario.fixture.clock.now(),
  };
}

async function crashPublishedRestore(
  scenario: Awaited<ReturnType<typeof prepareRecoveryScenario>>,
): Promise<Buffer> {
  const child = driver();
  await child.waitFor('ready');
  child.run({ ...scenario.request, pauseAt: 'publish.after_replace' });
  await child.waitFor('barrier');
  const damaged = await readFile(scenario.fixture.databasePath);
  damaged.fill(0, 0, 64);
  await writeFile(scenario.fixture.databasePath, damaged);
  child.kill();
  expect(await child.completed).toMatchObject({ signal: 'SIGKILL' });
  return damaged;
}

async function recoverSuccessfully(scenario: Awaited<ReturnType<typeof prepareRecoveryScenario>>) {
  const recovery = driver();
  await recovery.waitFor('ready');
  recovery.run(request(scenario));
  expect(await recovery.waitFor('result')).toEqual({ type: 'result', value: null });
  expect(await recovery.completed).toEqual({ code: 0, signal: null });
  return recovery;
}

async function expectMaintenance(scenario: Awaited<ReturnType<typeof prepareRecoveryScenario>>) {
  const recovery = driver();
  await recovery.waitFor('ready');
  recovery.run(request(scenario));
  const event = z
    .strictObject({
      type: z.literal('error'),
      value: errorEnvelopeSchema,
    })
    .parse(await recovery.waitFor('error'));
  expect(event.value.error.code).toBe('MAINTENANCE');
  expect(await recovery.completed).toEqual({ code: 0, signal: null });
}

async function fileInventory(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return fileInventory(path);
      if (!entry.isFile()) return [];
      const digest = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
      return [path + ':' + digest];
    }),
  );
  return nested.flat().sort();
}

async function digestExists(directory: string, digest: string): Promise<boolean> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && (await digestExists(path, digest))) return true;
    if (entry.isFile()) {
      const candidate = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
      if (candidate === digest) return true;
    }
  }
  return false;
}

it('keeps an already-succeeded terminal receipt and original finish time after a kill at receipt sync', async () => {
  const scenario = await prepareRecoveryScenario();
  scenarios.push(scenario);
  const child = driver();
  await child.waitFor('ready');
  child.run({ ...scenario.request, pauseAt: 'receipt.after_sync' });
  await child.waitFor('barrier');
  expect(existsSync(scenario.fixture.databasePath + '.recovery.json')).toBe(true);
  const api = await loadRecoveryApi();
  const statusSchema = z.object({
    data: z.object({ state: z.string(), finished_at: z.nullable(z.string()) }),
  });
  const before = statusSchema.parse(
    await api.getRecoveryStatus({
      backupDirectory: scenario.fixture.backupDirectory,
      operationId: scenario.request.envelope.operation_id,
    }),
  );
  expect(before.data.state).toBe('succeeded');
  const finishedAt = before.data.finished_at;
  child.kill();
  expect(await child.completed).toMatchObject({ signal: 'SIGKILL' });

  await recoverSuccessfully(scenario);
  expect(existsSync(scenario.fixture.databasePath + '.recovery.json')).toBe(false);
  scenario.fixture.reopen();
  expect(scenario.fixture.epoch()).not.toBe(scenario.oldEpoch);
  const after = statusSchema.parse(
    await api.getRecoveryStatus({
      backupDirectory: scenario.fixture.backupDirectory,
      operationId: scenario.request.envelope.operation_id,
    }),
  );
  expect(after.data.state).toBe('succeeded');
  expect(after.data.finished_at).toBe(finishedAt);
});

it.each(['recovery.before_replace', 'recovery.after_replace'] as const)(
  'retries rollback killed at %s, returns to old epoch, and retains damaged bytes',
  async (phase) => {
    const scenario = await prepareRecoveryScenario();
    scenarios.push(scenario);
    let missing = false;
    const watch = setInterval(() => {
      if (!existsSync(scenario.fixture.databasePath)) missing = true;
    }, 1);
    try {
      const damaged = await crashPublishedRestore(scenario);
      const damagedHash = createHash('sha256').update(damaged).digest('hex');
      const rollback = driver();
      await rollback.waitFor('ready');
      rollback.run({ ...request(scenario), pauseAt: phase });
      const barrier = await rollback.waitFor('barrier');
      expect(barrier).toEqual({ type: 'barrier', name: phase });
      expect(existsSync(scenario.fixture.databasePath)).toBe(true);
      rollback.kill();
      expect(await rollback.completed).toMatchObject({ signal: 'SIGKILL' });

      await recoverSuccessfully(scenario);
      expect(existsSync(scenario.fixture.databasePath)).toBe(true);
      expect(existsSync(scenario.fixture.databasePath + '.recovery.json')).toBe(false);
      expect(await digestExists(scenario.fixture.directory, damagedHash)).toBe(true);
      scenario.fixture.reopen();
      expect(scenario.fixture.epoch()).toBe(scenario.oldEpoch);
      const api = await loadRecoveryApi();
      expect(
        await api.getRecoveryStatus({
          backupDirectory: scenario.fixture.backupDirectory,
          operationId: scenario.request.envelope.operation_id,
        }),
      ).toMatchObject({ data: { state: 'failed' } });
    } finally {
      clearInterval(watch);
      expect(missing).toBe(false);
    }
  },
);

it('refuses a malformed recovery phase without changing the live file or guard bytes', async () => {
  const scenario = await prepareRecoveryScenario();
  scenarios.push(scenario);
  const child = driver();
  await child.waitFor('ready');
  child.run({ ...scenario.request, pauseAt: 'publish.after_replace' });
  await child.waitFor('barrier');
  child.kill();
  await child.completed;
  const guard = scenario.fixture.databasePath + '.recovery.json';
  const malformed = Buffer.from('{malformed phase');
  await writeFile(guard, malformed);
  const databaseBefore = await readFile(scenario.fixture.databasePath);

  await expectMaintenance(scenario);
  expect(await readFile(guard)).toEqual(malformed);
  expect(await readFile(scenario.fixture.databasePath)).toEqual(databaseBefore);
  const status = z.object({ data: z.object({ state: z.string() }) }).parse(
    await (
      await loadRecoveryApi()
    ).getRecoveryStatus({
      backupDirectory: scenario.fixture.backupDirectory,
      operationId: scenario.request.envelope.operation_id,
    }),
  );
  expect(status.data.state).toBe('running');
});

it('refuses invalid live SQLite beside a nonempty WAL and preserves every artifact', async () => {
  const scenario = await prepareRecoveryScenario();
  scenarios.push(scenario);
  const damaged = await crashPublishedRestore(scenario);
  const walPath = scenario.fixture.databasePath + '-wal';
  const walBytes = Buffer.from('synthetic nonempty WAL evidence');
  await writeFile(walPath, walBytes);
  const before = await fileInventory(scenario.fixture.directory);

  await expectMaintenance(scenario);
  expect(await fileInventory(scenario.fixture.directory)).toEqual(before);
  expect(await readFile(scenario.fixture.databasePath)).toEqual(damaged);
  expect(await readFile(walPath)).toEqual(walBytes);
  expect(existsSync(scenario.fixture.databasePath + '.recovery.json')).toBe(true);
  expect(await stat(scenario.fixture.databasePath)).toBeDefined();
});

it('refuses a recovery phase bound to different old-copy read metadata before writing damaged evidence', async () => {
  const scenario = await prepareRecoveryScenario();
  scenarios.push(scenario);
  const damaged = await crashPublishedRestore(scenario);
  const guardPath = scenario.fixture.databasePath + '.recovery.json';
  const raw: unknown = JSON.parse(await readFile(guardPath, 'utf8'));
  const phase = z
    .looseObject({
      previous_meta: z.looseObject({ read_revision: z.int() }),
    })
    .parse(raw);
  const tampered = {
    ...phase,
    previous_meta: {
      ...phase.previous_meta,
      read_revision: phase.previous_meta.read_revision + 1,
    },
  };
  await writeFile(guardPath, JSON.stringify(tampered) + '\n');
  const before = await fileInventory(scenario.fixture.directory);

  await expectMaintenance(scenario);
  expect(await fileInventory(scenario.fixture.directory)).toEqual(before);
  expect(await readFile(scenario.fixture.databasePath)).toEqual(damaged);
});
