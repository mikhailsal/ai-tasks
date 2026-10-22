import type { ChildProcess, Serializable } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProcessBarrier, type ProcessBarrier } from '../fixtures/process-barrier.js';

// Execution is pending T013's compiled dist/database-lock.js, then T021 acceptance.
// Missing runtime artifacts are setup failures, never evidence of a rejected lock.
const workerModule = fileURLToPath(new URL('../fixtures/lock-worker.mjs', import.meta.url));
const deadlineMs = 5_000;
interface WorkerEvent {
  type: string;
  code?: string;
  mode?: string;
  lockPath?: string;
  descriptors?: string[];
}

function nextEvent(child: ChildProcess, type: string): Promise<WorkerEvent> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const onMessage = (message: unknown): void => {
      if (typeof message !== 'object' || message === null || !('type' in message)) return;
      const event = message as WorkerEvent;
      if (event.type === type || event.type === 'failed') {
        cleanup();
        if (event.type === 'failed' && type !== 'failed') {
          reject(new Error(`Worker failed before ${type}: ${JSON.stringify(event)}`));
        } else resolve(event);
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(new Error(`Worker exited before ${type}: ${String(code)}/${String(signal)}`));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Worker did not report ${type} within ${deadlineMs}ms`));
    }, deadlineMs);
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function command(child: ChildProcess, message: Serializable, event: string): Promise<WorkerEvent> {
  const result = nextEvent(child, event);
  child.send(message);
  return result;
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Killed holder did not exit')), deadlineMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('Linux database connection-lifetime flock', () => {
  let directory: string;
  let databasePath: string;
  const barriers: ProcessBarrier[] = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ai-tasks-lifetime-lock-'));
    databasePath = join(directory, 'tasks.sqlite');
  });

  afterEach(async () => {
    await Promise.all(barriers.splice(0).map((barrier) => barrier.close()));
    await rm(directory, { recursive: true, force: true });
  });

  async function worker(): Promise<ChildProcess> {
    const barrier = createProcessBarrier(1, { modulePath: workerModule });
    barriers.push(barrier);
    await barrier.waitForReady(deadlineMs);
    const child = barrier.workers[0]?.child;
    if (!child) throw new Error('Missing lock worker');
    return child;
  }

  function acquire(child: ChildProcess, mode: 'shared' | 'exclusive', timeoutSeconds = 0) {
    return command(child, { type: 'acquire', databasePath, mode, timeoutSeconds }, 'acquired');
  }

  async function refuse(child: ChildProcess, mode: 'shared' | 'exclusive') {
    const failure = await command(
      child,
      { type: 'acquire', databasePath, mode, timeoutSeconds: 0 },
      'failed',
    );
    expect(failure.code).toBe('DB_CONFLICT');
  }

  it('allows independent shared holders and refuses exclusive until every holder closes', async () => {
    const first = await worker();
    const second = await worker();
    const maintenance = await worker();
    expect(await acquire(first, 'shared')).toMatchObject({ mode: 'shared' });
    await acquire(second, 'shared');
    await refuse(maintenance, 'exclusive');
    await command(first, { type: 'release' }, 'released');
    await refuse(maintenance, 'exclusive');
    await command(second, { type: 'release' }, 'released');
    await acquire(maintenance, 'exclusive');
    await refuse(first, 'shared');
  });

  it('waits a bounded interval before refusing an exclusive restore lock', async () => {
    const holder = await worker();
    const maintenance = await worker();
    await acquire(holder, 'shared');
    const started = performance.now();
    const failure = await command(
      maintenance,
      { type: 'acquire', databasePath, mode: 'exclusive', timeoutSeconds: 1 },
      'failed',
    );
    expect(failure.code).toBe('DB_CONFLICT');
    expect(performance.now() - started).toBeGreaterThanOrEqual(900);
    // The holder remains alive and owns the lock after the failed restore attempt.
    await command(holder, { type: 'ping' }, 'pong');
    await refuse(maintenance, 'exclusive');
  });

  it('grants a waiting exclusive restore after the live shared holder releases', async () => {
    const holder = await worker();
    const maintenance = await worker();
    await acquire(holder, 'shared');
    const acquiring = nextEvent(maintenance, 'acquiring');
    const acquired = nextEvent(maintenance, 'acquired');
    maintenance.send({ type: 'acquire', databasePath, mode: 'exclusive', timeoutSeconds: 3 });
    await acquiring;
    await command(holder, { type: 'release' }, 'released');
    expect(await acquired).toMatchObject({ mode: 'exclusive' });
    await refuse(holder, 'shared');
  });

  it('releases kernel ownership when a holder crashes without cleanup', async () => {
    const holder = await worker();
    const maintenance = await worker();
    await acquire(holder, 'shared');
    await refuse(maintenance, 'exclusive');
    const gone = exited(holder);
    holder.kill('SIGKILL');
    await gone;
    await acquire(maintenance, 'exclusive');
  });

  it('retains the same lockfile inode through release, refusal, crash, and reacquisition', async () => {
    const holder = await worker();
    const contender = await worker();
    const lockPath = `${databasePath}.lock`;
    expect(await acquire(holder, 'shared')).toMatchObject({ lockPath });
    const original = await stat(lockPath);
    await refuse(contender, 'exclusive');
    await command(holder, { type: 'release' }, 'released');
    expect(await stat(lockPath)).toMatchObject({ dev: original.dev, ino: original.ino });
    await acquire(holder, 'shared');
    const gone = exited(holder);
    holder.kill('SIGKILL');
    await gone;
    await acquire(contender, 'exclusive');
    await command(contender, { type: 'release' }, 'released');
    expect(await stat(lockPath)).toMatchObject({ dev: original.dev, ino: original.ino });
  });

  it('does not leak the lifetime descriptor into a long-lived spawned child', async () => {
    const holder = await worker();
    const maintenance = await worker();
    await acquire(holder, 'shared');
    const descendant = await command(
      holder,
      { type: 'spawn-descendant', lockPath: `${databasePath}.lock` },
      'descendant-ready',
    );
    expect(descendant.descriptors).toEqual([]);
    await command(holder, { type: 'release' }, 'released');
    // The descendant stays alive until fixture cleanup, so it cannot retain ownership.
    await acquire(maintenance, 'exclusive');
    await command(holder, { type: 'ping-descendant' }, 'descendant-pong');
  });
});
