import { fork, type ChildProcess, type Serializable } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface ProcessBarrierWorker {
  workerId: number;
  child: ChildProcess;
}

export interface ProcessBarrierOptions {
  modulePath?: string;
  workerArgs?: string[];
  workerEnv?: NodeJS.ProcessEnv;
  readyMessageType?: string;
  releaseMessage?: Serializable;
  shutdownMessage?: Serializable;
}

export interface ProcessBarrier {
  workers: ProcessBarrierWorker[];
  release(): void;
  waitForReady(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

const workerModule = fileURLToPath(new URL('./process-worker.mjs', import.meta.url));

/** Starts independent Node workers and attaches IPC readiness listeners before yielding. */
export function createProcessBarrier(
  workerCount: number,
  options: ProcessBarrierOptions = {},
): ProcessBarrier {
  if (!Number.isInteger(workerCount) || workerCount < 1) {
    throw new RangeError('Process barrier requires at least one worker');
  }

  const readiness = new Map<ChildProcess, Promise<void>>();
  const workers = Array.from({ length: workerCount }, (_, workerId) => {
    const child = fork(options.modulePath ?? workerModule, options.workerArgs ?? [], {
      env: { ...process.env, ...options.workerEnv, AI_TASKS_WORKER_ID: String(workerId) },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      execArgv: processArgumentsForFork(process.execArgv),
    });
    readiness.set(child, createReadySignal(child, options.readyMessageType ?? 'ready'));
    return { workerId, child };
  });
  let released = false;

  return {
    workers,
    release() {
      if (released) throw new Error('Process barrier has already been released');
      released = true;
      for (const { child } of workers) {
        if (child.connected) child.send(options.releaseMessage ?? { type: 'release' });
      }
    },
    async waitForReady(timeoutMs) {
      await Promise.all(workers.map(({ child }) => waitForReady(readiness.get(child), timeoutMs)));
    },
    async close() {
      await Promise.all(workers.map(({ child }) => stopChild(child, options.shutdownMessage)));
    },
  };
}

function processArgumentsForFork(argumentsList: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === undefined) continue;
    if (argument === '--input-type') {
      index += 1;
      continue;
    }
    if (argument.startsWith('--input-type=')) continue;
    if (argument === '-e' || argument === '--eval' || argument === '-p' || argument === '--print') {
      index += 1;
      continue;
    }
    result.push(argument);
  }
  return result;
}

function createReadySignal(child: ChildProcess, readyMessageType: string): Promise<void> {
  const readySignal = new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const onMessage = (message: unknown): void => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === readyMessageType
      ) {
        cleanup();
        resolve();
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`Barrier worker exited before ready with code ${String(code)}`));
    };
    child.on('message', onMessage);
    child.once('error', onError);
    child.once('exit', onExit);
  });
  void readySignal.catch(() => undefined);
  return readySignal;
}

function waitForReady(readySignal: Promise<void> | undefined, timeoutMs: number): Promise<void> {
  if (readySignal === undefined) {
    return Promise.reject(new Error('Barrier worker readiness signal is missing'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Process did not reach barrier within ${timeoutMs}ms`)),
      timeoutMs,
    );
    readySignal.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function stopChild(
  child: ChildProcess,
  shutdownMessage: Serializable = { type: 'shutdown' },
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      child.off('exit', finish);
      child.off('error', finish);
      resolve();
    };
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 1_250);
    const termTimer = setTimeout(() => child.kill('SIGTERM'), 250);
    child.once('exit', finish);
    child.once('error', finish);
    if (child.connected) {
      try {
        child.send(shutdownMessage);
      } catch {
        child.kill('SIGTERM');
      }
    } else {
      child.kill('SIGTERM');
    }
  });
}
