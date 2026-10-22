import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createConnection } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { mutationEnvelopeSchema } from '../../src/schema/envelopes.js';
import { BODY_LIMIT_BYTES, jsonBodySchema } from '../../src/schema/values.js';
import { recoveryJobEnvelopeSchema } from '../../src/schema/recovery.js';
import {
  coordinateRestore,
  startSupervisorControl,
  supervisorMutexDatabasePath,
  supervisorSocketPath,
} from '../../src/runtime/supervisor-control.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';

const directories: string[] = [];
const controls: Array<Awaited<ReturnType<typeof startSupervisorControl>>> = [];
afterEach(async () => {
  await Promise.all(controls.splice(0).map((control) => control.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-supervisor-control-'));
  directories.push(directory);
  return { directory, databasePath: join(directory, 'application.sqlite') };
}

function envelope() {
  return mutationEnvelopeSchema.parse({
    operation_id: randomUUID(),
    database_epoch: randomUUID(),
    payload: { backup_id: randomUUID(), affected_projects: [] },
  });
}

function job(operationId: string = randomUUID()) {
  return recoveryJobEnvelopeSchema.parse({
    ok: true,
    data: {
      job_id: randomUUID(),
      operation_id: operationId,
      state: 'queued',
      started_at: '2026-10-22T00:00:00.000Z',
      finished_at: null,
      result: null,
      error: null,
    },
    meta: {
      database_epoch: randomUUID(),
      timezone: 'Europe/Moscow',
      now: '2026-10-22T00:00:00.000Z',
      operation_id: operationId,
      audit_ids: [],
    },
  });
}

it('uses the active supervisor socket and holds its private mutex for server lifetime', async () => {
  const { databasePath } = await setup();
  const requestEnvelope = envelope();
  const accepted = job(requestEnvelope.operation_id);
  let submitted: unknown;
  const control = await startSupervisorControl({
    databasePath,
    async submitRestore(input) {
      submitted = input;
      return accepted;
    },
  });
  controls.push(control);
  const socketInfo = await stat(control.socketPath);
  expect(socketInfo.isSocket()).toBe(true);
  expect(socketInfo.mode & 0o777).toBe(0o600);
  const directoryInfo = await stat(dirname(control.socketPath));
  expect(directoryInfo.mode & 0o777).toBe(0o700);

  const result = await coordinateRestore({
    databasePath,
    projectSlug: 'alpha',
    envelope: requestEnvelope,
    async startStandalone() {
      throw new Error('standalone fallback must not run while supervisor is available');
    },
  });
  expect(result).toEqual(accepted);
  expect(submitted).toEqual({
    projectSlug: 'alpha',
    envelope: requestEnvelope,
    caller: 'cli',
  });
  expect(() =>
    acquireDatabaseLock({
      databasePath: supervisorMutexDatabasePath(databasePath),
      mode: 'exclusive',
      timeoutSeconds: 0,
    }),
  ).toThrow(expect.objectContaining({ code: 'DB_CONFLICT' }));

  await control.close();
  controls.splice(controls.indexOf(control), 1);
  const released = acquireDatabaseLock({
    databasePath: supervisorMutexDatabasePath(databasePath),
    mode: 'exclusive',
    timeoutSeconds: 0,
  });
  releaseDatabaseLock(released);
});

it('keeps the socket open for a delayed restore submission after the request half-closes', async () => {
  const { databasePath } = await setup();
  const requestEnvelope = envelope();
  const expected = job(requestEnvelope.operation_id);
  let releaseSubmission = () => {};
  let markEntered = () => {};
  const submissionStarted = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const submissionReleased = new Promise<void>((resolve) => {
    releaseSubmission = resolve;
  });
  const control = await startSupervisorControl({
    databasePath,
    async submitRestore() {
      markEntered();
      await submissionReleased;
      return expected;
    },
  });
  controls.push(control);

  const response = coordinateRestore({
    databasePath,
    projectSlug: 'alpha',
    envelope: requestEnvelope,
    async startStandalone() {
      throw new Error('standalone fallback must not run');
    },
  });
  await submissionStarted;
  releaseSubmission();
  expect(await response).toEqual(expected);
});

it('round-trips a maximum public mutation body through the private request wrapper', async () => {
  const { databasePath } = await setup();
  const base = mutationEnvelopeSchema.parse({
    operation_id: randomUUID(),
    database_epoch: randomUUID(),
    payload: {
      backup_id: randomUUID(),
      affected_projects: [],
      confirmation: { asserted: true, user_text: '' },
    },
  });
  const userText = 'x'.repeat(BODY_LIMIT_BYTES - Buffer.byteLength(JSON.stringify(base)));
  const maximum = mutationEnvelopeSchema.parse({
    ...base,
    payload: {
      backup_id: randomUUID(),
      affected_projects: [],
      confirmation: { asserted: true, user_text: userText },
    },
  });
  expect(Buffer.byteLength(JSON.stringify(maximum))).toBe(BODY_LIMIT_BYTES);
  jsonBodySchema.parse(maximum);
  const accepted = job(maximum.operation_id);
  const control = await startSupervisorControl({
    databasePath,
    async submitRestore(input) {
      expect(input.envelope).toEqual(maximum);
      return accepted;
    },
  });
  controls.push(control);
  const result = await coordinateRestore({
    databasePath,
    projectSlug: 'alpha',
    envelope: maximum,
    async startStandalone() {
      throw new Error('valid maximum body must use the active socket');
    },
  });
  expect(result).toEqual(accepted);

  const oversized = mutationEnvelopeSchema.parse({
    ...base,
    payload: {
      backup_id: randomUUID(),
      affected_projects: [],
      confirmation: { asserted: true, user_text: `${userText}x` },
    },
  });
  await expect(
    coordinateRestore({
      databasePath,
      projectSlug: 'alpha',
      envelope: oversized,
      async startStandalone() {
        return accepted;
      },
    }),
  ).rejects.toThrow();
});

it('holds the supervisor mutex for the entire standalone fallback', async () => {
  const { databasePath } = await setup();
  const requestEnvelope = envelope();
  const expected = job(requestEnvelope.operation_id);
  const result = await coordinateRestore({
    databasePath,
    projectSlug: 'alpha',
    envelope: requestEnvelope,
    async startStandalone() {
      expect(() =>
        acquireDatabaseLock({
          databasePath: supervisorMutexDatabasePath(databasePath),
          mode: 'exclusive',
          timeoutSeconds: 0,
        }),
      ).toThrow(expect.objectContaining({ code: 'DB_CONFLICT' }));
      return expected;
    },
  });
  expect(result).toEqual(expected);
  const released = acquireDatabaseLock({
    databasePath: supervisorMutexDatabasePath(databasePath),
    mode: 'exclusive',
    timeoutSeconds: 0,
  });
  releaseDatabaseLock(released);
});

it('refuses standalone fallback when the supervisor mutex is held but its socket is unavailable', async () => {
  const { databasePath } = await setup();
  const lock = acquireDatabaseLock({
    databasePath: supervisorMutexDatabasePath(databasePath),
    mode: 'exclusive',
    timeoutSeconds: 0,
  });
  let standaloneStarted = false;
  try {
    await expect(
      coordinateRestore({
        databasePath,
        projectSlug: 'alpha',
        envelope: envelope(),
        async startStandalone() {
          standaloneStarted = true;
          return job();
        },
      }),
    ).rejects.toMatchObject({ code: 'MAINTENANCE' });
    expect(standaloneStarted).toBe(false);
  } finally {
    releaseDatabaseLock(lock);
  }
});

it('does not remove a regular file occupying the private socket path', async () => {
  const { databasePath } = await setup();
  const path = supervisorSocketPath(databasePath);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from('must remain');
  await writeFile(path, bytes);
  try {
    await expect(
      startSupervisorControl({
        databasePath,
        async submitRestore() {
          return job();
        },
      }),
    ).rejects.toThrow();
    expect(await readFile(path)).toEqual(bytes);
  } finally {
    await rm(path, { force: true });
  }
});

it('rejects malformed and oversized frames on the actual Unix socket', async () => {
  const { databasePath } = await setup();
  const control = await startSupervisorControl({
    databasePath,
    async submitRestore() {
      return job();
    },
  });
  controls.push(control);
  async function rawFrame(frame: Buffer): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(control.socketPath);
      let response = Buffer.alloc(0);
      socket.on('connect', () => socket.end(frame));
      socket.on('data', (chunk: Buffer) => {
        response = Buffer.concat([response, chunk]);
      });
      socket.on('end', () => {
        try {
          resolve(JSON.parse(response.toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
      socket.on('error', reject);
    });
  }
  const malformed = z
    .object({ ok: z.literal(false), error: z.object({ code: z.string() }) })
    .parse(await rawFrame(Buffer.from('{bad}\n')));
  expect(malformed.error.code).toBe('INTERNAL_ERROR');
  await expect(rawFrame(Buffer.alloc(1024 * 1024 + 4097, 0x61))).rejects.toThrow();
});
