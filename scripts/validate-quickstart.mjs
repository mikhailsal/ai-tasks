import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

// Run after npm ci, runtime verification, and the production build. The enclosing
// run-suite supervisor owns the job deadline and any detached recovery descendants.
const started = performance.now();
const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-quickstart-'));
const environment = {
  ...process.env,
  FORCE_COLOR: undefined,
  NO_COLOR: '1',
  AI_TASKS_DB_PATH: join(directory, 'validation.sqlite'),
  AI_TASKS_BACKUP_DIR: join(directory, 'backups'),
};
const checks = [];
const errorExits = {
  VALIDATION_ERROR: 2,
  CONFIRMATION_REQUIRED: 4,
  IDEMPOTENCY_CONFLICT: 4,
  REVISION_CONFLICT: 4,
  DATABASE_EPOCH_CONFLICT: 4,
};
let sequence = 0;
let server;
let epoch;

async function cli(args, options = {}) {
  const flags = options.aggregate ? ['--all-projects'] : ['--project', options.project ?? 'demo'];
  const input = options.input;
  const file = join(directory, `input-${sequence++}.json`);
  if (input !== undefined) await writeFile(file, `${JSON.stringify(input)}\n`);
  const result = spawnSync(
    process.execPath,
    [resolve('dist/cli.js'), ...args, ...flags, '--json', ...(input ? ['--input', file] : [])],
    {
      env: { ...environment, ...options.environment },
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const failed = options.error !== undefined;
  if (failed) assert.ok(Object.hasOwn(errorExits, options.error));
  assert.equal(result.status, failed ? errorExits[options.error] : 0, JSON.stringify(result));
  assert.equal(failed ? result.stdout : result.stderr, '');
  const text = failed ? result.stderr : result.stdout;
  assert.equal(text.endsWith('\n'), true);
  assert.equal(text.trimEnd().split('\n').length, 1);
  const response = JSON.parse(text);
  assert.equal(response.ok, !failed);
  if (failed) assert.equal(response.error.code, options.error);
  return response;
}

function proposal(payload, revision) {
  return {
    operation_id: randomUUID(),
    database_epoch: epoch,
    expected_config_revision: 1,
    ...(revision === undefined ? {} : { expected_revision: revision }),
    ...payload,
  };
}

async function availablePort() {
  const listener = createServer();
  await new Promise((accept, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', accept);
  });
  const address = listener.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((accept, reject) =>
    listener.close((error) => (error ? reject(error) : accept())),
  );
  return address.port;
}

async function launchServer() {
  const origin = `http://127.0.0.1:${await availablePort()}`;
  const child = fork(resolve('dist/api.js'), [], {
    env: { ...environment, AI_TASKS_PORT: new URL(origin).port, AI_TASKS_ORIGIN: origin },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    execArgv: [],
  });
  let stderr = '';
  child.stderr.on('data', (bytes) => (stderr += bytes.toString('utf8')));
  const closed = new Promise((accept) => child.once('close', accept));
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        child.kill('SIGTERM');
        await closed;
      } finally {
        clearTimeout(deadline);
      }
    }
    await closed;
    assert.equal(child.signalCode, null, `API shutdown signal: ${stderr}`);
    assert.equal(child.exitCode, 0, `API shutdown exit: ${stderr}`);
  };
  try {
    await new Promise((accept, reject) => {
      const deadline = setTimeout(
        () => reject(new Error(`API readiness timeout: ${stderr}`)),
        15_000,
      );
      child.once('message', (message) => {
        clearTimeout(deadline);
        if (message?.type === 'ready' && message.envelope?.ok) accept();
        else reject(new Error(`Unexpected readiness: ${JSON.stringify(message)}`));
      });
      child.once('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(deadline);
        reject(new Error(`API exited before readiness: ${stderr}`));
      });
    });
    return { origin, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function http(path, input, status = 200, origin = server.origin) {
  const response = await globalThis.fetch(`${server.origin}/api/v1${path}`, {
    method: input === undefined ? 'GET' : 'PATCH',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-AI-Tasks-Mutation': '1' },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    signal: globalThis.AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, status);
  const result = await response.json();
  assert.equal(result.ok, status < 400);
  return result;
}

async function ordinaryWorkflow() {
  const description = '  ## Контекст\n\n**Точный исходник** 👩🏽‍💻\n<script>alert(1)</script>';
  const created = await cli(['task', 'create'], {
    input: proposal({
      kind: 'ordinary',
      title: 'Quickstart: 🧪',
      emoji: '🧪',
      description,
      priority: { model: 'classic', level: 'high' },
    }),
  });
  let task = created.data;
  const detail = (await cli(['task', 'get', task.id])).data;
  assert.equal(detail.description, description);
  assert.equal(detail.title, 'Quickstart: 🧪');
  assert.equal(detail.emoji, '🧪');
  assert.equal(detail.rendered_html.includes('<script>'), false);
  assert.equal(task.priority.model, 'classic');
  const audit = async () => (await cli(['audit', 'list', '--entity-id', task.id])).data.items;
  const initialAudit = await audit();
  await cli(['task', 'transition', task.id], {
    input: proposal({ to_status_id: 'done' }, task.revision),
    error: 'VALIDATION_ERROR',
  });
  assert.deepEqual(await audit(), initialAudit);
  for (const to_status_id of ['planning', 'ready', 'in_progress', 'sanity_check']) {
    task = (
      await cli(['task', 'transition', task.id], {
        input: proposal({ to_status_id }, task.revision),
      })
    ).data;
  }
  await cli(['task', 'transition', task.id], {
    input: proposal({ to_status_id: 'done' }, task.revision),
    error: 'CONFIRMATION_REQUIRED',
  });
  const final = proposal(
    {
      to_status_id: 'done',
      confirmation: { asserted: true, user_text: 'Проверил эту задачу вручную.' },
    },
    task.revision,
  );
  task = (await cli(['task', 'transition', task.id], { input: final })).data;
  const committedAudit = await audit();
  assert.equal(committedAudit[0].confirmation.user_text, final.confirmation.user_text);
  assert.equal(committedAudit[0].actor, 'ai-cli:demo');
  assert.deepEqual((await cli(['task', 'transition', task.id], { input: final })).data, task);
  assert.deepEqual(await audit(), committedAudit);
  await cli(['task', 'transition', task.id], {
    input: { ...final, confirmation: { ...final.confirmation, user_text: 'Другая заявка' } },
    error: 'IDEMPOTENCY_CONFLICT',
  });
  checks.push('compiled CLI UTF-8/file input/workflow/confirmation/replay/conflicting reuse');
  return task;
}

async function transportAndRecovery(task) {
  server = await launchServer();
  const path = `/projects/demo/tasks/${task.id}`;
  assert.deepEqual((await http(path)).data, (await cli(['task', 'get', task.id])).data);
  const flat = proposal({ description: 'HTTP: новая версия' }, task.revision);
  const { description, ...guards } = flat;
  const request = { ...guards, payload: { description } };
  await http(path, request, 403, 'http://untrusted.invalid');
  const changed = (await http(path, request)).data;
  await cli(['task', 'update', task.id], {
    input: proposal({ description: 'Устаревшая правка' }, task.revision),
    error: 'REVISION_CONFLICT',
  });
  assert.equal((await cli(['task', 'get', task.id])).data.description, changed.description);
  checks.push('production HTTP/CLI equivalence/origin refusal/stale revision');
  const backup = (
    await cli(['backup', 'create'], {
      input: proposal({ expected_settings_revision: 1 }),
    })
  ).data;
  await cli(['task', 'update', task.id], {
    input: proposal({ description: 'После резервной копии' }, changed.revision),
  });
  const auditBefore = (await cli(['audit', 'list'], { aggregate: true })).data.items;
  const validation = (await cli(['backup', 'validate', backup.id], { aggregate: true })).data;
  assert.equal(validation.integrity, 'ok');
  const restore = proposal({
    expected_settings_revision: 1,
    backup_id: backup.id,
    affected_projects: validation.affected_projects,
    confirmation: { asserted: true, user_text: 'Восстановить временную проверочную базу.' },
  });
  const receipt = (await cli(['backup', 'restore'], { input: restore })).data;
  assert.equal(receipt.state, 'succeeded');
  assert.notEqual(receipt.result.database_epoch, epoch);
  // The durable CLI receipt can precede the supervisor's normal-generation reopen.
  // Its owned HTTP status awaits that reopen before exposing terminal success.
  assert.deepEqual((await http(`/backups/jobs/${receipt.job_id}?all_projects=true`)).data, receipt);
  assert.equal(
    (await http('/meta?all_projects=true')).data.database_epoch,
    receipt.result.database_epoch,
  );
  const unopenedDirectory = join(directory, 'not-a-database');
  const status = (
    await cli(['backup', 'status', '--operation-id', restore.operation_id], {
      aggregate: true,
      environment: { AI_TASKS_DB_PATH: join(unopenedDirectory, 'unopened.sqlite') },
    })
  ).data;
  assert.deepEqual(status, receipt);
  await assert.rejects(access(unopenedDirectory), { code: 'ENOENT' });
  await cli(['backup', 'restore'], { input: restore, error: 'DATABASE_EPOCH_CONFLICT' });
  const auditAfter = (await cli(['audit', 'list'], { aggregate: true })).data.items;
  for (const row of auditBefore) assert.ok(auditAfter.some((entry) => entry.id === row.id));
  assert.equal((await http(path)).data.description, changed.description);
  await server.close();
  server = await launchServer();
  assert.equal((await http(path)).data.description, changed.description);
  assert.equal(
    (await cli(['meta'], { aggregate: true })).data.database_epoch,
    receipt.result.database_epoch,
  );
  checks.push('online backup/validated union/restore/new epoch/audit union/DB-free status/restart');
}

try {
  const migrated = spawnSync(process.execPath, ['dist/migrate.js'], {
    env: environment,
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.ifError(migrated.error);
  assert.equal(migrated.status, 0, migrated.stderr);
  epoch = (await cli(['meta'], { aggregate: true })).data.database_epoch;
  await cli(['project', 'create'], {
    input: {
      operation_id: randomUUID(),
      database_epoch: epoch,
      slug: 'demo',
      name: 'Validation project',
      emoji: '🧭',
      priority: 10,
    },
  });
  const config = (await cli(['config', 'get'])).data;
  assert.equal(config.revision, 1);
  assert.equal(config.priority_model.type, 'classic');
  checks.push('isolated production migration/meta/project/config');
  const task = await ordinaryWorkflow();
  for (const args of [['task', 'list'], ['agenda'], ['priorities'], ['stats']])
    await cli(args, { aggregate: true });
  await transportAndRecovery(task);
  process.stdout.write(
    `${JSON.stringify({ ok: true, checks, duration_ms: Math.round(performance.now() - started) })}\n`,
  );
} finally {
  try {
    await server?.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
