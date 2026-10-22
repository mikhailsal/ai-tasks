import { fork, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod/mini';
import { createProject } from '../../src/core/projects/commands.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { responseEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import { createOrdinaryFixture, ordinaryInput, type OrdinaryFixture } from './ordinary-work.js';
import { availablePort } from './http-delivery.js';
import { observeWorkerDatabase } from './worker-process.js';

export const backupInfo = z.object({
  id: z.uuid(),
  created_at: z.iso.datetime(),
  database_epoch: z.uuid(),
  schema_version: z.literal(1),
  checksum: z.string().check(z.minLength(1)),
  size_bytes: z.number().check(z.positive()),
  settings_revision: z.number(),
  projects: z.array(
    z.object({ project_slug: z.string(), revision: z.number(), config_revision: z.number() }),
  ),
});
export const affectedProject = z.object({
  project_slug: z.string(),
  expected_revision: z.nullable(z.number()),
  expected_config_revision: z.nullable(z.number()),
});
export const backupPage = z.object({
  items: z.array(backupInfo),
  next_cursor: z.nullable(z.string()),
});
export const backupValidation = z.object({
  backup: backupInfo,
  compatible: z.literal(true),
  integrity: z.literal('ok'),
  affected_projects: z.array(affectedProject),
});
export const recoveryResult = z.object({
  database_epoch: z.uuid(),
  affected_projects: z.array(z.string()),
  audit_ids: z.array(z.uuid()),
  recovery_snapshot_id: z.uuid(),
});
export const recoveryJob = z.object({
  job_id: z.uuid(),
  operation_id: z.uuid(),
  state: z.enum(['queued', 'running', 'succeeded', 'failed']),
  started_at: z.iso.datetime(),
  finished_at: z.nullable(z.iso.datetime()),
  result: z.nullable(recoveryResult),
  error: z.nullable(jsonValueSchema),
});
export type RecoveryTransport = 'cli' | 'http';
export type RecoveryCall = {
  command: string[];
  path: string;
  method?: 'GET' | 'POST';
  input?: Record<string, JsonValue>;
  project?: string;
  scope?: boolean;
};
const cliEntry = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const apiEntry = fileURLToPath(new URL('../../dist/api.js', import.meta.url));
function cliInput(input: Record<string, JsonValue> | undefined) {
  if (input === undefined) return undefined;
  const { payload, ...guards } = input;
  if (payload === undefined) return JSON.stringify(input);
  if (payload === null || Array.isArray(payload) || typeof payload !== 'object')
    throw new Error('Recovery fixture mutation payload must be an object');
  return JSON.stringify({ ...guards, ...payload });
}

type RecoveryOptions = { seed?: (fixture: OrdinaryFixture) => void | Promise<void> };
async function seededDatabase(directory: string, options: RecoveryOptions) {
  const seed = await createOrdinaryFixture();
  try {
    seed.clock.set(Date.now());
    createProject(
      seed.human,
      'alpha',
      ordinaryInput(seed, { slug: 'alpha', name: 'Восстановление', emoji: '🗃️' }),
    );
    const task = z.object({ id: z.uuid() }).parse(
      createTask(
        seed.human,
        'alpha',
        ordinaryInput(seed, {
          kind: 'ordinary',
          title: 'Исходная задача',
          description: '  **Исходник** 👩🏽‍💻\n\nСохранить точно.',
        }),
      ).data,
    );
    await options.seed?.(seed);
    const path = join(directory, 'application.sqlite');
    await seed.connection.sqlite.backup(path);
    return { path, epoch: seed.epoch, taskId: task.id };
  } finally {
    await seed.close();
  }
}
function launchServer(path: string, backupDirectory: string, origin: string) {
  const child = fork(apiEntry, [], {
    env: {
      ...process.env,
      AI_TASKS_DB_PATH: path,
      AI_TASKS_BACKUP_DIR: backupDirectory,
      AI_TASKS_PORT: new URL(origin).port,
      AI_TASKS_ORIGIN: origin,
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    execArgv: [],
  });
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Recovery API startup timed out: ${stderr}`)),
      8000,
    );
    const finish = (error?: Error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    child.once('error', finish);
    child.once('exit', () => finish(new Error(`Recovery API exited before readiness: ${stderr}`)));
    child.on('message', (message: unknown) => {
      const parsed = z
        .object({ type: z.literal('ready'), envelope: metaEnvelopeSchema })
        .safeParse(message);
      if (parsed.success) finish();
      else finish(new Error(`Invalid recovery API readiness: ${JSON.stringify(message)}`));
    });
  });
  return {
    ready,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return exited;
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        child.kill('SIGTERM');
        await exited;
      } finally {
        clearTimeout(kill);
      }
    },
  };
}
export async function createRecoveryHarness(options: RecoveryOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-recovery-contract-'));
  let server: ReturnType<typeof launchServer> | undefined;
  try {
    const seeded = await seededDatabase(directory, options);
    const backupDirectory = join(directory, 'backups');
    const origin = `http://127.0.0.1:${await availablePort()}`;
    server = launchServer(seeded.path, backupDirectory, origin);
    await server.ready;
    async function request(transport: RecoveryTransport, call: RecoveryCall) {
      if (transport === 'cli') {
        const result = spawnSync(
          process.execPath,
          [
            cliEntry,
            ...call.command,
            ...(call.scope === false
              ? []
              : call.project
                ? ['--project', call.project]
                : ['--all-projects']),
            '--json',
            ...(call.input === undefined ? [] : ['--input', '-']),
          ],
          {
            env: {
              ...process.env,
              // Playwright forces reporter colors; do not leak conflicting color flags into CLI.
              FORCE_COLOR: undefined,
              NO_COLOR: '1',
              AI_TASKS_DB_PATH: seeded.path,
              AI_TASKS_BACKUP_DIR: backupDirectory,
            },
            encoding: 'utf8',
            input: cliInput(call.input),
            timeout: 8000,
          },
        );
        if (result.error) throw result.error;
        if (result.signal || result.status === null)
          throw new Error('Recovery CLI did not exit normally');
        const text = result.status === 0 ? result.stdout : result.stderr;
        if (
          (result.status === 0 ? result.stderr : result.stdout) !== '' ||
          !text.endsWith('\n') ||
          text.trimEnd().split('\n').length !== 1
        )
          throw new Error(
            `Recovery CLI violated JSON stream/EOF contract: ${JSON.stringify({
              status: result.status,
              stdout: result.stdout.slice(0, 4096),
              stderr: result.stderr.slice(0, 4096),
            })}`,
          );
        return { status: result.status, envelope: responseEnvelopeSchema.parse(JSON.parse(text)) };
      }
      const response = await fetch(`${origin}/api/v1${call.path}`, {
        method: call.method ?? 'GET',
        headers: { Origin: origin, 'Content-Type': 'application/json', 'X-AI-Tasks-Mutation': '1' },
        ...(call.input === undefined ? {} : { body: JSON.stringify(call.input) }),
      });
      return {
        status: response.status,
        envelope: responseEnvelopeSchema.parse(await response.json()),
      };
    }
    function envelope(payload: JsonValue = {}, overrides: Record<string, JsonValue> = {}) {
      return {
        operation_id: randomUUID(),
        database_epoch: seeded.epoch,
        expected_config_revision: 1,
        expected_settings_revision: 1,
        payload,
        ...overrides,
      };
    }
    return {
      ...seeded,
      directory,
      backupDirectory,
      origin,
      request,
      envelope,
      inspect: <Value>(read: Parameters<typeof observeWorkerDatabase<Value>>[1]) =>
        observeWorkerDatabase(seeded.path, read),
      snapshot: () =>
        observeWorkerDatabase(seeded.path, (sqlite) =>
          [
            'application_state',
            'projects',
            'project_configs',
            'tasks',
            'audit_records',
            'operation_receipts',
            'project_emoji_reservations',
            'task_emoji_reservations',
          ].map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
        ),
      async restart() {
        await server?.close();
        server = launchServer(seeded.path, backupDirectory, origin);
        await server.ready;
      },
      async close() {
        try {
          await server?.close();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    try {
      await server?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    throw error;
  }
}
export type RecoveryHarness = Awaited<ReturnType<typeof createRecoveryHarness>>;
export function successfulRecovery(response: Awaited<ReturnType<RecoveryHarness['request']>>) {
  return successEnvelopeSchema.parse(response.envelope).data;
}
export async function waitRecoveryJob(harness: RecoveryHarness, jobId: string) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const response = await harness.request('http', {
      command: [],
      path: `/backups/jobs/${jobId}?all_projects=true`,
    });
    if (response.status !== 200)
      throw new Error(`Recovery status failed: ${JSON.stringify(response.envelope)}`);
    const job = recoveryJob.parse(successfulRecovery(response));
    if (job.result !== null || job.error !== null) return job;
    await delay(20);
  }
  throw new Error('Recovery job did not reach a terminal receipt');
}
