import { readFile, stat, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getRecoveryStatus } from '../../src/core/recovery/index.js';
import { coordinateRestore } from '../../src/runtime/supervisor-control.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { prepareRecoveryScenario } from '../fixtures/recovery-scenario.js';
import { startRecoverySupervisor } from '../fixtures/recovery-supervisor.js';

let scenario: Awaited<ReturnType<typeof prepareRecoveryScenario>>;
let server: Awaited<ReturnType<typeof startRecoverySupervisor>> | undefined;
let blocker: ReturnType<typeof acquireDatabaseLock> | undefined;
beforeEach(async () => {
  scenario = await prepareRecoveryScenario();
});
afterEach(async () => {
  if (blocker) releaseDatabaseLock(blocker);
  blocker = undefined;
  await server?.close();
  server = undefined;
  await scenario.fixture.close();
});

it('a compiled supervisor drains its generation for private CLI restore, retains HTTP, and starts the verified new epoch', async () => {
  const { fixture } = scenario;
  server = await startRecoverySupervisor(fixture);
  try {
    const readiness = await server.ready;
    expect(readiness.meta.database_epoch).toBe(scenario.oldEpoch);
    const inode = (await stat(`${fixture.databasePath}.lock`)).ino;
    blocker = acquireDatabaseLock({
      databasePath: fixture.databasePath,
      mode: 'shared',
      timeoutSeconds: 0,
    });
    const accepted = await coordinateRestore({
      databasePath: fixture.databasePath,
      projectSlug: 'alpha',
      envelope: scenario.request.envelope,
      startStandalone: async () => {
        throw new Error('An active supervisor must receive the restore');
      },
    });
    expect(accepted.data.state).toBe('queued');
    expect(accepted.data.operation_id).toBe(scenario.request.envelope.operation_id);
    const response = await fetch(`${server.origin}/api/v1/meta?all_projects=true`);
    expect(response.status).toBe(503);
    expect(errorEnvelopeSchema.parse(await response.json()).error.code).toBe('MAINTENANCE');
    const status = await getRecoveryStatus({
      backupDirectory: fixture.backupDirectory,
      jobId: accepted.data.job_id,
    });
    expect(['queued', 'running']).toContain(status.data.state);
    expect(await readFile(fixture.databasePath)).toBeInstanceOf(Buffer);
    releaseDatabaseLock(blocker);
    blocker = undefined;
    let completed = status;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      completed = await getRecoveryStatus({
        backupDirectory: fixture.backupDirectory,
        jobId: accepted.data.job_id,
      });
      if (completed.data.state === 'succeeded' || completed.data.state === 'failed') break;
      await delay(10);
    }
    expect(completed.data.state).toBe('succeeded');
    expect(completed.data.result?.database_epoch).not.toBe(scenario.oldEpoch);
    let metadata: Response | undefined;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      metadata = await fetch(`${server.origin}/api/v1/meta?all_projects=true`);
      if (metadata.status === 200) break;
      await delay(10);
    }
    if (!metadata) throw new Error('No metadata response');
    expect(metadata.status).toBe(200);
    expect(metaEnvelopeSchema.parse(await metadata.json()).meta.database_epoch).toBe(
      completed.data.result?.database_epoch,
    );
    expect((await stat(`${fixture.databasePath}.lock`)).ino).toBe(inode);
    await server.close();
    fixture.reopen();
    const audit = fixture.connection.sqlite
      .prepare("SELECT actor,origin FROM audit_records WHERE action='database.restore'")
      .all();
    expect(audit).toEqual([{ actor: 'ai-cli:alpha', origin: 'cli' }]);
    expect(
      fixture.connection.sqlite.prepare('SELECT title FROM tasks ORDER BY title').all(),
    ).toEqual([{ title: 'Работа из снимка' }]);
  } finally {
    if (blocker) releaseDatabaseLock(blocker);
    await server.close();
    await fixture.close();
  }
});

it('preserves a rejected restore error and resumes ordinary access while an unrelated shared connection remains open', async () => {
  const { fixture } = scenario;
  server = await startRecoverySupervisor(fixture);
  try {
    await server.ready;
    blocker = acquireDatabaseLock({
      databasePath: fixture.databasePath,
      mode: 'shared',
      timeoutSeconds: 0,
    });
    const envelope = {
      ...scenario.request.envelope,
      payload: { backup_id: scenario.backupId, affected_projects: [] },
    };
    await expect(
      coordinateRestore({
        databasePath: fixture.databasePath,
        projectSlug: 'alpha',
        envelope,
        startStandalone: async () => {
          throw new Error('Unexpected fallback');
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const response = await fetch(`${server.origin}/api/v1/meta?all_projects=true`);
    expect(response.status).toBe(200);
    expect(metaEnvelopeSchema.parse(await response.json()).meta.database_epoch).toBe(
      scenario.oldEpoch,
    );
  } finally {
    if (blocker) releaseDatabaseLock(blocker);
    await server.close();
    await fixture.close();
  }
});

it('binds HTTP before refusing an unresolved startup manifest, without claiming readiness or touching database bytes', async () => {
  const { fixture } = scenario;
  const manifest = `${fixture.databasePath}.recovery.json`;
  await writeFile(manifest, '{"invalid":true}\n');
  const before = await readFile(fixture.databasePath);
  server = await startRecoverySupervisor(fixture);
  let announced = false;
  void server.ready.then(
    () => {
      announced = true;
    },
    () => {},
  );
  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 800; attempt += 1) {
      try {
        response = await fetch(`${server.origin}/api/v1/meta?all_projects=true`);
        break;
      } catch {
        await delay(10);
      }
    }
    if (!response) throw new Error('Maintenance HTTP listener never became reachable');
    expect(response.status).toBe(503);
    expect(errorEnvelopeSchema.parse(await response.json()).error.code).toBe('MAINTENANCE');
    expect(announced).toBe(false);
    expect(await readFile(fixture.databasePath)).toEqual(before);
    expect(await readFile(manifest, 'utf8')).toBe('{"invalid":true}\n');
  } finally {
    await server.close();
    await fixture.close();
  }
});
