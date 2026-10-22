import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const api = fileURLToPath(new URL('../../dist/api.js', import.meta.url));
const helper = fileURLToPath(new URL('../../dist/data-helper.js', import.meta.url));
type Identity = { pid: number; start: string; parent: number; state: string };

function identity(pid: number): Identity | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/u);
    const start = fields[19];
    const state = fields[0];
    const parent = Number(fields[1]);
    if (start === undefined || state === undefined || !Number.isInteger(parent)) return;
    return { pid, start, parent, state };
  } catch {
    return;
  }
}

function living(owner: Identity): boolean {
  const current = identity(owner.pid);
  return current?.start === owner.start && current.state !== 'Z' && current.state !== 'X';
}

function signal(owner: Identity, value: NodeJS.Signals) {
  if (living(owner)) {
    try {
      process.kill(owner.pid, value);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    }
  }
}

function children(owner: Identity): Identity[] {
  if (!living(owner)) return [];
  try {
    const pids = readFileSync(`/proc/${owner.pid}/task/${owner.pid}/children`, 'utf8');
    return pids
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .flatMap((pid) => {
        const child = identity(Number(pid));
        return child?.parent === owner.pid ? [child] : [];
      });
  } catch {
    return [];
  }
}

function commandIncludes(owner: Identity, entry: string): boolean {
  try {
    return (
      living(owner) &&
      readFileSync(`/proc/${owner.pid}/cmdline`, 'utf8').split('\0').includes(entry)
    );
  } catch {
    return false;
  }
}

export function boundedResult<Value>(result: Promise<Value>, milliseconds: number) {
  return new Promise<Value | 'still-running'>((resolve, reject) => {
    const timer = setTimeout(() => resolve('still-running'), milliseconds);
    void result.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No loopback port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

export async function supervisedServe(databasePath: string) {
  const port = await availablePort();
  const child = spawn(process.execPath, [cli, 'serve', '--all-projects', '--json'], {
    env: {
      ...process.env,
      AI_TASKS_DB_PATH: databasePath,
      AI_TASKS_PORT: String(port),
      AI_TASKS_ORIGIN: `http://127.0.0.1:${port}`,
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.pid === undefined) throw new Error('CLI did not spawn');
  const root = identity(child.pid);
  if (!root) throw new Error('CLI identity unavailable');
  const owned = new Map<number, Identity>([[root.pid, root]]);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );
  const ready = new Promise<ReturnType<typeof metaEnvelopeSchema.parse>>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    // Production allows 15s; leave room for the four startup processes under
    // parallel suite load while keeping the complete test within its 10s limit.
    const timer = setTimeout(() => {
      lines.close();
      reject(new Error('CLI readiness deadline exceeded'));
    }, 8000);
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
      reject(new Error('CLI exited before readiness'));
    });
    lines.once('line', (line) => {
      finish();
      try {
        const envelope = metaEnvelopeSchema.parse(JSON.parse(line));
        capture();
        capture();
        resolve(envelope);
      } catch (error) {
        reject(error);
      }
    });
  });
  const capture = () => {
    for (const owner of [...owned.values()]) {
      for (const descendant of children(owner)) owned.set(descendant.pid, descendant);
    }
  };
  const workers = () => {
    capture();
    capture();
    return [...owned.values()].filter((owner) => {
      if (!commandIncludes(owner, cli)) return false;
      const argumentsList = readFileSync(`/proc/${owner.pid}/cmdline`, 'utf8').split('\0');
      return argumentsList.includes('worker') && argumentsList.includes('run');
    });
  };
  return {
    ready,
    completed,
    output: () => ({ stdout, stderr }),
    stop: () => signal(root, 'SIGTERM'),
    workers,
    killWorker() {
      const worker = workers()[0];
      if (!worker) throw new Error('Owned recurrence worker is unavailable');
      signal(worker, 'SIGKILL');
    },
    killHelper() {
      capture();
      capture();
      const apiChild = [...owned.values()].find(
        (owner) => owner.parent === root.pid && commandIncludes(owner, api),
      );
      const dataChild = [...owned.values()].find(
        (owner) => owner.parent === apiChild?.pid && commandIncludes(owner, helper),
      );
      if (!apiChild || !dataChild)
        throw new Error('Owned API/data-helper process chain unavailable');
      signal(dataChild, 'SIGKILL');
      return { apiPid: apiChild.pid, helperPid: dataChild.pid };
    },
    async close() {
      capture();
      capture();
      signal(root, 'SIGTERM');
      if ((await boundedResult(completed, 750)) === 'still-running') {
        for (const owner of [...owned.values()].reverse()) signal(owner, 'SIGKILL');
        if ((await boundedResult(completed, 750)) === 'still-running')
          throw new Error('Owned CLI cleanup failed');
      }
      for (const owner of [...owned.values()].reverse()) signal(owner, 'SIGKILL');
      const deadline = Date.now() + 500;
      while ([...owned.values()].some(living)) {
        if (Date.now() >= deadline) throw new Error('Owned descendant cleanup failed');
        await delay(10);
      }
    },
  };
}
