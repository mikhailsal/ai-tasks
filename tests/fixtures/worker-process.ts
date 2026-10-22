import { fork, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { successEnvelopeSchema, type SuccessEnvelope } from '../../src/schema/envelopes.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import { createProject, archiveProject } from '../../src/core/projects/commands.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { controlRecurrence } from '../../src/core/recurrence/control.js';
import { openDatabase } from '../../src/core/database/open.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createOrdinaryFixture, ordinaryInput } from './ordinary-work.js';

const entry = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const day = 86_400_000;
export async function createWorkerDatabase(options: { daysOld?: number; archived?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-worker-process-'));
  const path = join(directory, 'worker.sqlite');
  const seed = await createOrdinaryFixture();
  try {
    const first = Date.now() - (options.daysOld ?? 3) * day;
    seed.clock.set(first);
    createProject(
      seed.human,
      'alpha',
      ordinaryInput(seed, { slug: 'alpha', name: 'Работник', emoji: '🌅' }),
    );
    createProject(
      seed.human,
      'beta',
      ordinaryInput(
        seed,
        { slug: 'beta', name: 'Другая область', emoji: '🌳' },
        { projectSlug: 'beta' },
      ),
    );
    const create = (slug: string) =>
      taskDetailSchema.parse(
        createTask(seed.human, slug, {
          ...ordinaryInput(
            seed,
            {
              kind: 'recurring',
              title: 'Обработка срока',
              recurrence: {
                first_deadline: new Date(first).toISOString(),
                schedule: {
                  mode: 'calendar',
                  pattern: 'days',
                  every: 1,
                  local_time: new Date(first + 3 * 3_600_000).toISOString().slice(11, 23),
                },
                miss_policy: 'record_miss',
                confirmation_window_ms: 0,
              },
            },
            { projectSlug: slug },
          ),
          expected_settings_revision: 1,
        }).data,
      );
    const alpha = create('alpha');
    const beta = create('beta');
    if (options.archived)
      archiveProject(seed.human, 'alpha', {
        ...ordinaryInput(
          seed,
          { affected_tasks: [{ task_id: alpha.id, expected_revision: alpha.revision }] },
          { revision: 1 },
        ),
        expected_settings_revision: 1,
      });
    else
      controlRecurrence(seed.human, 'alpha', alpha.id, {
        ...ordinaryInput(seed, { to_status_id: 'active' }, { revision: alpha.revision }),
        expected_settings_revision: 1,
      });
    controlRecurrence(seed.human, 'beta', beta.id, {
      ...ordinaryInput(
        seed,
        { to_status_id: 'active' },
        { projectSlug: 'beta', revision: beta.revision },
      ),
      expected_settings_revision: 1,
    });
    await seed.connection.sqlite.backup(path);
    return {
      path,
      directory,
      epoch: seed.epoch,
      alphaId: alpha.id,
      betaId: beta.id,
      first,
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await seed.close();
  }
}
export type WorkerDatabase = Awaited<ReturnType<typeof createWorkerDatabase>>;

export function observeWorkerDatabase<T>(
  path: string,
  read: (sqlite: ReturnType<typeof openDatabase>['sqlite']) => T,
): T {
  const lock = acquireDatabaseLock({ databasePath: path, mode: 'shared' });
  try {
    const connection = openDatabase({ path, lock });
    try {
      return read(connection.sqlite);
    } finally {
      connection.close();
    }
  } finally {
    releaseDatabaseLock(lock);
  }
}
export function workerDatabaseSnapshot(path: string) {
  return observeWorkerDatabase(path, (sqlite) =>
    [
      'application_state',
      'projects',
      'project_configs',
      'tasks',
      'schedule_generations',
      'recurrence_state',
      'recurrence_intervals',
      'occurrences',
      'audit_records',
      'operation_receipts',
      'project_emoji_reservations',
      'task_emoji_reservations',
    ].map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
  );
}
export function compiledWorkerMeta(path: string) {
  return spawnSync(process.execPath, [entry, 'meta', '--all-projects', '--json'], {
    env: { ...process.env, AI_TASKS_DB_PATH: path },
    encoding: 'utf8',
    timeout: 5000,
  });
}

type WorkerExit = { code: number | null; signal: NodeJS.Signals | null };
type WorkerFirst =
  | { kind: 'ready'; envelope: SuccessEnvelope }
  | { kind: 'exit'; result: WorkerExit }
  | { kind: 'invalid'; line: string }
  | { kind: 'timeout' };
export function startCompiledWorker(
  path: string,
  args = ['worker', 'run', '--project', 'alpha', '--json'],
) {
  const child = fork(entry, args, {
    env: { ...process.env, AI_TASKS_DB_PATH: path },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    execArgv: [],
  });
  let stdout = '';
  let stderr = '';
  let buffer = '';
  const ready = Promise.withResolvers<WorkerFirst>();
  const closed = Promise.withResolvers<WorkerExit>();
  const deadline = setTimeout(() => ready.resolve({ kind: 'timeout' }), 5000);
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
    buffer += chunk;
    const end = buffer.indexOf('\n');
    if (end === -1) return;
    const line = buffer.slice(0, end);
    try {
      const result = successEnvelopeSchema.safeParse(JSON.parse(line));
      ready.resolve(
        result.success ? { kind: 'ready', envelope: result.data } : { kind: 'invalid', line },
      );
    } catch {
      ready.resolve({ kind: 'invalid', line });
    }
    clearTimeout(deadline);
  });
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.once('error', () => {
    ready.resolve({ kind: 'invalid', line: 'Child could not start' });
  });
  child.once('close', (code, signal) => {
    clearTimeout(deadline);
    const result = { code, signal };
    closed.resolve(result);
    ready.resolve({ kind: 'exit', result });
  });
  async function stop(mode: 'SIGTERM' | 'ipc' = 'SIGTERM') {
    if (child.exitCode !== null || child.signalCode !== null) return closed.promise;
    const escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      if (mode === 'ipc' && child.connected) child.send({ type: 'shutdown' });
      else child.kill('SIGTERM');
      return await closed.promise;
    } finally {
      clearTimeout(escalation);
    }
  }
  return {
    child,
    first: ready.promise,
    closed: closed.promise,
    stop,
    output: () => ({ stdout, stderr }),
  };
}
