import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer, connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/core/database/open.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { inheritedBackups } from '../fixtures/inherited-backups.js';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const migration = fileURLToPath(new URL('../../dist/migrate.js', import.meta.url));
const lanHost = Object.values(networkInterfaces())
  .flatMap((entries) => entries ?? [])
  .find((entry) => entry.family === 'IPv4' && !entry.internal)?.address;
let directory: string;
let environment: NodeJS.ProcessEnv;
let inherited: Awaited<ReturnType<typeof inheritedBackups>> | undefined;

async function availablePort(host: string): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No port available');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function accepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

type Reply = { status: number; body: unknown };
/** Node's fetch cannot choose Host, so send the exact browser-boundary headers directly. */
function send(
  target: { host: string; port: number },
  options: { path: string; method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { ...target, path: options.path, method: options.method ?? 'GET', headers: options.headers },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) }),
        );
      },
    );
    outgoing.once('error', reject);
    outgoing.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}

function auditActors(databasePath: string): unknown[] {
  const lock = acquireDatabaseLock({ databasePath, mode: 'shared' });
  const connection = openDatabase({ path: databasePath, lock });
  try {
    return connection.sqlite.prepare('SELECT actor FROM audit_records ORDER BY rowid').all();
  } finally {
    connection.close();
    releaseDatabaseLock(lock);
  }
}

function startServe(env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [cli, 'serve', '--all-projects'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
  const completed = new Promise<number | null>((resolve) => child.once('close', resolve));
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No readiness: ${stderr}`)), 8000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.split('\n').length < 4) return;
      clearTimeout(timer);
      resolve(stdout);
    });
    child.once('exit', () => reject(new Error(`Stopped before readiness: ${stderr}`)));
  });
  return { child, ready, completed, stderr: () => stderr };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ai-tasks-network-'));
  inherited = await inheritedBackups(directory);
  environment = {
    ...process.env,
    ...inherited.environment,
    AI_TASKS_DB_PATH: join(directory, 'application.sqlite'),
    AI_TASKS_BACKUP_DIR: join(directory, 'backups'),
    NODE_ENV: 'production',
  };
  delete environment.AI_TASKS_HOST;
  delete environment.AI_TASKS_ORIGIN;
  const result = spawnSync(process.execPath, [migration], { env: environment, timeout: 5000 });
  expect(result.status).toBe(0);
});
afterAll(async () => {
  try {
    if (inherited) expect(await inherited.read()).toEqual(inherited.record);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('serve local network configuration failures', () => {
  it.each([
    [{ AI_TASKS_HOST: '192.0.2.123' }, 'AI_TASKS_HOST is not an address of this computer'],
    [{ AI_TASKS_HOST: '0.0.0.0' }, 'AI_TASKS_HOST must be one specific address, not all networks'],
    [{ AI_TASKS_HOST: 'localhost' }, 'AI_TASKS_HOST must be an IPv4 address'],
  ])('rejects %j before listening', async (settings, message) => {
    const port = await availablePort('127.0.0.1');
    const result = spawnSync(process.execPath, [cli, 'serve', '--all-projects', '--json'], {
      env: { ...environment, ...settings, AI_TASKS_PORT: String(port) },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(errorEnvelopeSchema.parse(JSON.parse(result.stderr)).error).toEqual({
      code: 'VALIDATION_ERROR',
      message,
      details: null,
      retryable: false,
    });
    expect(await accepts('127.0.0.1', port)).toBe(false);
  });

  it.skipIf(lanHost === undefined)('rejects a network origin that does not match', () => {
    const result = spawnSync(process.execPath, [cli, 'serve', '--all-projects', '--json'], {
      env: {
        ...environment,
        AI_TASKS_HOST: lanHost,
        AI_TASKS_ORIGIN: `http://127.0.0.1:3000`,
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(errorEnvelopeSchema.parse(JSON.parse(result.stderr)).error.message).toBe(
      'AI_TASKS_ORIGIN must equal http://HOST:PORT in local network mode',
    );
  });
});

// Requires a non-internal IPv4 address; a host without one reports this case as skipped.
describe.skipIf(lanHost === undefined)('serve on a real local network address', () => {
  it('serves the network origin only, keeps browser protections and attributes writes to the web', async () => {
    const host = lanHost ?? '';
    const port = await availablePort(host);
    const origin = `http://${host}:${port}`;
    const serve = startServe({ ...environment, AI_TASKS_HOST: host, AI_TASKS_PORT: String(port) });
    try {
      expect(await serve.ready).toBe(
        `Web interface on the local network: ${origin}/\n` +
          'Warning: every device on this network can read and change all data without signing in.\n' +
          'Offline reopening is unavailable over plain HTTP; an open tab keeps showing loaded data.\n',
      );
      const target = { host, port };
      const meta = await send(target, { path: '/api/v1/meta?all_projects=true' });
      expect(meta.status).toBe(200);
      const epoch = metaEnvelopeSchema.parse(meta.body).data.database_epoch;
      expect(await accepts('127.0.0.1', port)).toBe(false);
      for (const name of [`127.0.0.1:${port}`, `localhost:${port}`])
        expect(
          await send(target, { path: '/api/v1/meta?all_projects=true', headers: { host: name } }),
        ).toMatchObject({ status: 403, body: { error: { code: 'ORIGIN_REJECTED' } } });
      const create = (headerOrigin: string) =>
        send(target, {
          path: '/api/v1/projects/lan-check',
          method: 'POST',
          headers: {
            origin: headerOrigin,
            'content-type': 'application/json',
            'x-ai-tasks-mutation': '1',
          },
          body: {
            operation_id: randomUUID(),
            database_epoch: epoch,
            payload: { slug: 'lan-check', name: 'Сеть', emoji: '📶' },
          },
        });
      expect(await create('http://attacker.example')).toMatchObject({
        status: 403,
        body: { error: { code: 'ORIGIN_REJECTED' } },
      });
      expect(auditActors(environment.AI_TASKS_DB_PATH ?? '')).toEqual([]);
      expect((await create(origin)).status).toBe(201);
      expect(auditActors(environment.AI_TASKS_DB_PATH ?? '')).toEqual([{ actor: 'human-web' }]);
      serve.child.kill('SIGTERM');
      expect(await serve.completed).toBe(0);
      expect(serve.stderr()).toBe('');
    } finally {
      if (serve.child.exitCode === null && serve.child.signalCode === null) {
        serve.child.kill('SIGKILL');
        await serve.completed;
      }
    }
  });
});
