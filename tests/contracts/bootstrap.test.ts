import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { startDataHelper } from '../../src/api/helper-client.js';
import { openDatabase } from '../../src/core/database/open.js';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const migration = fileURLToPath(new URL('../../dist/migrate.js', import.meta.url));
let directory: string;
let databasePath: string;
let environment: NodeJS.ProcessEnv;

function invoke(args: string[], input?: string, env = environment) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    env,
    input,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 2_097_152,
  });
  if (result.error) throw result.error;
  expect(result.signal).toBeNull();
  return result;
}

function oneJsonLine(output: string): unknown {
  expect(output.endsWith('\n')).toBe(true);
  const lines = output.split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe('');
  return JSON.parse(lines[0] ?? '');
}

function durableSnapshot() {
  const lock = acquireDatabaseLock({ databasePath, mode: 'shared' });
  const connection = openDatabase({ path: databasePath, lock });
  try {
    return {
      settings: connection.sqlite.prepare('SELECT * FROM application_state').all(),
      projects: connection.sqlite.prepare('SELECT * FROM projects').all(),
      tasks: connection.sqlite.prepare('SELECT * FROM tasks').all(),
      audits: connection.sqlite.prepare('SELECT * FROM audit_records').all(),
      receipts: connection.sqlite.prepare('SELECT * FROM operation_receipts').all(),
    };
  } finally {
    connection.close();
    releaseDatabaseLock(lock);
  }
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('No loopback port available');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function serveProcess(env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [cli, 'serve', '--all-projects', '--json'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal })),
  );
  const ready = new Promise<ReturnType<typeof metaEnvelopeSchema.parse>>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Compiled CLI readiness deadline exceeded')),
      7000,
    );
    const lines = createInterface({ input: child.stdout });
    const finish = () => {
      clearTimeout(timer);
      lines.close();
    };
    child.once('error', (error) => {
      finish();
      reject(error);
    });
    child.once('exit', () => {
      finish();
      reject(new Error('CLI stopped before readiness'));
    });
    lines.once('line', (line) => {
      finish();
      try {
        resolve(metaEnvelopeSchema.parse(JSON.parse(line)));
      } catch (error) {
        reject(error);
      }
    });
  });
  return { child, completed, ready, output: () => ({ stdout, stderr }) };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ai-tasks-bootstrap-'));
  databasePath = join(directory, 'application.sqlite');
  environment = { ...process.env, AI_TASKS_DB_PATH: databasePath, NODE_ENV: 'production' };
  const result = spawnSync(process.execPath, [migration], {
    env: environment,
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.error) throw result.error;
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(oneJsonLine(result.stdout)).toMatchObject({ ok: true, schema_version: 1 });
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('compiled foundation CLI contracts', () => {
  it('emits one metadata envelope and preserves all durable state on repeated reads', () => {
    const before = durableSnapshot();
    const first = invoke(['meta', '--all-projects', '--json']);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    const result = metaEnvelopeSchema.parse(oneJsonLine(first.stdout));
    expect(result.data).toMatchObject({
      timezone: 'Europe/Moscow',
      settings_revision: 1,
      schema_version: 1,
      contract_version: 1,
      maintenance: false,
    });
    const second = invoke(['meta', '--all-projects', '--json']);
    expect(metaEnvelopeSchema.parse(oneJsonLine(second.stdout)).data).toEqual(result.data);
    expect(durableSnapshot()).toEqual(before);
  });

  it('reads file/stdin JSON equivalently without rewriting the file and terminates on empty EOF', async () => {
    const path = join(directory, 'input.json');
    const source = ' { } \n';
    await writeFile(path, source);
    const file = invoke(['meta', '--all-projects', '--json', '--input', path]);
    const piped = invoke(['meta', '--all-projects', '--json', '--input', '-'], source);
    expect(file.status).toBe(0);
    expect(piped.status).toBe(0);
    expect(metaEnvelopeSchema.parse(oneJsonLine(file.stdout)).data).toEqual(
      metaEnvelopeSchema.parse(oneJsonLine(piped.stdout)).data,
    );
    expect(await readFile(path, 'utf8')).toBe(source);
    const empty = invoke(['meta', '--all-projects', '--json', '--input', '-'], '');
    expect(empty.status).toBe(2);
    expect(empty.stdout).toBe('');
    expect(errorEnvelopeSchema.parse(oneJsonLine(empty.stderr)).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it.each(['{"actor":"human-web"}', '{"__proto__":{"changed":true}}'])(
    'rejects unknown JSON input keys without silently discarding them: %s',
    (input) => {
      const before = durableSnapshot();
      const result = invoke(['meta', '--all-projects', '--json', '--input', '-'], input);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(errorEnvelopeSchema.parse(oneJsonLine(result.stderr)).error.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(durableSnapshot()).toEqual(before);
    },
  );

  it.each([
    ['meta', '--json'],
    ['meta', '--project', 'alpha', '--all-projects', '--json'],
    ['meta', '--all-projects', '--project', 'alpha', '--json'],
    ['meta', '--all-projects', '--unknown-option', '--json'],
    ['unknown-command', '--json'],
  ])('returns structured nonzero errors without diagnostic stdout for %j', (...args) => {
    const result = invoke(args);
    expect(result.status, JSON.stringify({ args, stderr: result.stderr })).toBe(2);
    expect(result.stdout).toBe('');
    expect(errorEnvelopeSchema.parse(oneJsonLine(result.stderr)).error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(result.stderr).not.toContain(databasePath);
  });

  it.each([['help', '--json'], ['version', '--json'], ['--help'], ['--version']])(
    'allows informational command %j without creating a database or lock',
    (...args) => {
      const absent = join(directory, 'uncreated', 'application.sqlite');
      const result = invoke(args, undefined, { ...environment, AI_TASKS_DB_PATH: absent });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout.length).toBeGreaterThan(0);
      if (args.includes('--json')) expect(oneJsonLine(result.stdout)).toMatchObject({ ok: true });
      expect(existsSync(absent)).toBe(false);
      expect(existsSync(`${absent}.lock`)).toBe(false);
      expect(existsSync(join(directory, 'uncreated'))).toBe(false);
    },
  );

  it('refuses metadata against an absent database without initializing files or leaking its path', () => {
    const absent = join(directory, 'absent.sqlite');
    const result = invoke(['meta', '--all-projects', '--json'], undefined, {
      ...environment,
      AI_TASKS_DB_PATH: absent,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(errorEnvelopeSchema.parse(oneJsonLine(result.stderr)).error.code).toBe('INTERNAL_ERROR');
    expect(result.stderr).not.toContain(absent);
    expect(existsSync(absent)).toBe(false);
    expect(existsSync(`${absent}.lock`)).toBe(false);
  });
});

describe('compiled API process lifecycle and real helper locks', () => {
  it('forwards one CLI serve readiness envelope, serves matching HTTP metadata, and drains on SIGTERM', async () => {
    const port = await availablePort();
    const process = serveProcess({
      ...environment,
      AI_TASKS_PORT: String(port),
      AI_TASKS_ORIGIN: `http://127.0.0.1:${port}`,
    });
    try {
      const ready = await process.ready;
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/meta?all_projects=true`);
      expect(response.status).toBe(200);
      expect(metaEnvelopeSchema.parse(await response.json()).data).toEqual(ready.data);
      process.child.kill('SIGTERM');
      expect(await process.completed).toEqual({ code: 0, signal: null });
      expect(metaEnvelopeSchema.parse(oneJsonLine(process.output().stdout)).data).toEqual(
        ready.data,
      );
      expect(process.output().stderr).toBe('');
      const lock = acquireDatabaseLock({ databasePath, mode: 'exclusive', timeoutSeconds: 0 });
      releaseDatabaseLock(lock);
    } finally {
      if (process.child.exitCode === null && process.child.signalCode === null) {
        process.child.kill('SIGKILL');
        await process.completed;
      }
    }
  });

  it('holds the helper shared lock for its full connection lifetime while the supervisor remains independent', async () => {
    const helper = await startDataHelper({ databasePath });
    const app = createApp({ helper });
    await app.ready();
    try {
      expect(() =>
        acquireDatabaseLock({ databasePath, mode: 'exclusive', timeoutSeconds: 0 }),
      ).toThrow(expect.objectContaining({ code: 'DB_CONFLICT' }));
      await helper.close();
      const exclusive = acquireDatabaseLock({ databasePath, mode: 'exclusive', timeoutSeconds: 0 });
      releaseDatabaseLock(exclusive);
      // The still-live supervisor can serve the shell after its data connection is gone.
      expect((await app.inject({ url: '/', headers: { host: '127.0.0.1:3000' } })).statusCode).toBe(
        200,
      );
      const unavailable = await app.inject({
        url: '/api/v1/meta?all_projects=true',
        headers: { host: '127.0.0.1:3000' },
      });
      expect(unavailable.statusCode).toBe(503);
      expect(errorEnvelopeSchema.parse(unavailable.json()).error.code).toBe('MAINTENANCE');
    } finally {
      await app.close();
    }
  });
});
