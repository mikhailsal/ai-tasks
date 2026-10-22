import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { domainError } from '../core/errors.js';
import type { SuccessEnvelope } from '../schema/envelopes.js';
import { errorCodeSchema } from '../schema/errors.js';
import { helperCommandSchema, helperMessageSchema, type HelperCommand } from './helper-protocol.js';
import { activeProjectScopes } from './active-projects.js';

type PendingRequest = {
  resolve: (result: SuccessEnvelope) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function helperEntry(): string {
  const entries = [
    new URL('./data-helper.js', import.meta.url),
    new URL('../../dist/data-helper.js', import.meta.url),
  ];
  const entry = entries.find((url) => existsSync(url));
  if (!entry) throw domainError('INTERNAL_ERROR', 'Compiled API data helper is unavailable');
  return fileURLToPath(entry);
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve) => {
    const kill = setTimeout(() => child.kill('SIGKILL'), 35_000);
    child.once('exit', () => {
      clearTimeout(kill);
      resolve();
    });
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    else child.kill('SIGTERM');
  });
}

function requestData(
  child: ChildProcess,
  pending: Map<string, PendingRequest>,
  request: HelperCommand,
  unavailable: () => Error,
): Promise<SuccessEnvelope> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(unavailable());
      },
      request.operation === 'backup.restore.accept' ? 30_000 : 10_000,
    );
    pending.set(id, { resolve, reject, timer });
    child.send({ type: 'request', id, ...request }, (error) => {
      if (!error) return;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(unavailable());
    });
  });
}

function helperEnvironment(options: { databasePath: string; backupDirectory?: string }) {
  return {
    ...process.env,
    AI_TASKS_DB_PATH: options.databasePath,
    ...(options.backupDirectory === undefined
      ? {}
      : { AI_TASKS_BACKUP_DIR: options.backupDirectory }),
  };
}

export async function startDataHelper(options: {
  databasePath: string;
  backupDirectory?: string;
  onUnexpectedFailure?: (error: Error) => void;
}) {
  const child = fork(helperEntry(), [], {
    env: helperEnvironment(options),
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'json',
  });
  const pending = new Map<string, PendingRequest>();
  let closing: Promise<void> | undefined;
  let failed = false;
  let started = false;
  let notified = false;
  const unavailable = () => domainError('MAINTENANCE', 'API data helper is unavailable');
  const rejectPending = () => {
    failed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(unavailable());
    }
    pending.clear();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const startupTimer = setTimeout(() => reject(unavailable()), 10_000);
      const fail = (error: Error) => {
        clearTimeout(startupTimer);
        rejectPending();
        reject(error);
        if (started && !closing && !notified) {
          notified = true;
          options.onUnexpectedFailure?.(unavailable());
        }
      };
      child.once('error', () => fail(unavailable()));
      child.once('exit', () => fail(unavailable()));
      child.once('disconnect', () => fail(unavailable()));
      child.on('message', (message: unknown) => {
        const parsed = helperMessageSchema.safeParse(message);
        if (!parsed.success) {
          fail(unavailable());
          child.kill('SIGTERM');
          return;
        }
        const response = parsed.data;
        if (response.type === 'ready') {
          clearTimeout(startupTimer);
          resolve();
          return;
        }
        if (response.type === 'fatal') {
          fail(
            domainError(
              errorCodeSchema.parse(response.error.error.code),
              response.error.error.message,
              response.error.error.details,
            ),
          );
          return;
        }
        const entry = pending.get(response.id);
        if (!entry) return;
        pending.delete(response.id);
        clearTimeout(entry.timer);
        if (response.envelope.ok) entry.resolve(response.envelope);
        else
          entry.reject(
            domainError(
              errorCodeSchema.parse(response.envelope.error.code),
              response.envelope.error.message,
              response.envelope.error.details,
            ),
          );
      });
    });
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  started = true;
  const request = (command: HelperCommand): Promise<SuccessEnvelope> => {
    const validated = helperCommandSchema.parse(command);
    if (failed || closing || !child.connected) return Promise.reject(unavailable());
    return requestData(child, pending, validated, unavailable);
  };
  return {
    request,
    activeProjectScopes: () => activeProjectScopes(request),
    close(): Promise<void> {
      closing ??= stopChild(child).finally(rejectPending);
      return closing;
    },
  };
}

export type DataHelper = Awaited<ReturnType<typeof startDataHelper>>;
