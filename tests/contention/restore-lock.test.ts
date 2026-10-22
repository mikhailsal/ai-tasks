import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { prepareRecoveryScenario } from '../fixtures/recovery-scenario.js';
import { buildRecoveryDriver, startRecoveryDriver } from '../fixtures/recovery-process.js';
import { startSharedHolders } from '../fixtures/recovery-lock-holder.js';
import { boundedResult } from '../fixtures/supervised-serve.js';

let compiled: Awaited<ReturnType<typeof buildRecoveryDriver>>;
const scenarios: Awaited<ReturnType<typeof prepareRecoveryScenario>>[] = [];
const children: ReturnType<typeof startRecoveryDriver>[] = [];
const holders: Awaited<ReturnType<typeof startSharedHolders>>[] = [];
beforeAll(async () => {
  compiled = await buildRecoveryDriver();
});
afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => child.close()));
  await Promise.all(holders.splice(0).map((holder) => holder.close()));
  await Promise.all(scenarios.splice(0).map(({ fixture }) => fixture.close()));
});
afterAll(() => compiled?.close());
function driver() {
  const child = startRecoveryDriver(compiled.entry);
  children.push(child);
  return child;
}
async function liveHash(path: string) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

it('waits for every independent shared holder and acquires exclusive without an inherited lock', async () => {
  const scenario = await prepareRecoveryScenario();
  scenarios.push(scenario);
  const { fixture, request } = scenario;
  const holding = await startSharedHolders(fixture.databasePath, 2);
  holders.push(holding);
  const before = await liveHash(fixture.databasePath);
  const inode = (await stat(`${fixture.databasePath}.lock`)).ino;
  const child = driver();
  await child.waitFor('ready');
  child.run({ ...request, lockTimeoutSeconds: 5 });
  expect(await child.waitFor('attempting')).toEqual({ type: 'attempting', descriptors: [] });
  const locked = child.waitFor('locked', 6000);
  expect(await boundedResult(locked, 150)).toBe('still-running');
  expect(await liveHash(fixture.databasePath)).toBe(before);
  await holding.release(0);
  expect(await boundedResult(locked, 150)).toBe('still-running');
  expect(await liveHash(fixture.databasePath)).toBe(before);
  expect(existsSync(`${fixture.databasePath}.recovery.json`)).toBe(false);
  await holding.release(1);
  expect(await locked).toEqual({ type: 'locked' });
  expect((await child.waitFor('result')).type).toBe('result');
  expect(await child.completed).toEqual({ code: 0, signal: null });
  fixture.reopen();
  expect(fixture.epoch()).not.toBe(scenario.oldEpoch);
  expect(fixture.connection.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
  expect((await stat(`${fixture.databasePath}.lock`)).ino).toBe(inode);
  expect(child.stderr()).toBe('');
});

it('bounds an exclusive-lock timeout without publishing or changing any closed live bytes', async () => {
  const scenario = await prepareRecoveryScenario();
  scenarios.push(scenario);
  const { fixture, request } = scenario;
  const holding = await startSharedHolders(fixture.databasePath, 1);
  holders.push(holding);
  const before = await liveHash(fixture.databasePath);
  const child = driver();
  await child.waitFor('ready');
  child.run({ ...request, lockTimeoutSeconds: 0.15 });
  expect(await child.waitFor('attempting')).toEqual({ type: 'attempting', descriptors: [] });
  const failure = await child.waitFor('error');
  expect(failure).toMatchObject({
    type: 'error',
    value: { ok: false, error: { code: 'DB_CONFLICT' } },
  });
  await child.completed;
  expect(child.hasEvent('locked')).toBe(false);
  expect(await liveHash(fixture.databasePath)).toBe(before);
  expect(existsSync(`${fixture.databasePath}.recovery.json`)).toBe(false);
  expect(child.stderr()).toBe('');
  await holding.release(0);
  fixture.reopen();
  expect(fixture.epoch()).toBe(scenario.oldEpoch);
});

it('holds the exclusive stable inode until verification completes and permits only verified normal reopening', async () => {
  const scenario = await prepareRecoveryScenario();
  scenarios.push(scenario);
  const { fixture, request } = scenario;
  const child = driver();
  await child.waitFor('ready');
  child.run({ ...request, pauseAt: 'reopen.after_verify' });
  await child.waitFor('barrier');
  const inode = (await stat(`${fixture.databasePath}.lock`)).ino;
  for (const mode of ['shared', 'exclusive'] as const) {
    expect(() =>
      acquireDatabaseLock({ databasePath: fixture.databasePath, mode, timeoutSeconds: 0 }),
    ).toThrow(expect.objectContaining({ code: 'DB_CONFLICT' }));
  }
  child.release();
  const result = await child.waitFor('result');
  const receipt = z
    .object({ type: z.literal('result'), value: z.object({ database_epoch: z.uuid() }) })
    .parse(result);
  await child.completed;
  const lock = acquireDatabaseLock({
    databasePath: fixture.databasePath,
    mode: 'exclusive',
    timeoutSeconds: 0,
  });
  releaseDatabaseLock(lock);
  fixture.reopen();
  expect(fixture.epoch()).toBe(receipt.value.database_epoch);
  expect(fixture.connection.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
  expect(fixture.connection.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  expect(fixture.connection.sqlite.pragma('synchronous', { simple: true })).toBe(1);
  expect(fixture.connection.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
  expect((await stat(`${fixture.databasePath}.lock`)).ino).toBe(inode);
});
