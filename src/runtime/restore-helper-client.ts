import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { domainError } from '../core/errors.js';
import {
  decodeRestoreCommand,
  decodeRestoreMessage,
  type RestoreHelperCommand,
  type RestoreHelperMessage,
  type RestoreResult,
} from '../core/recovery/command.js';

const unavailable = () =>
  domainError('MAINTENANCE', 'Recovery outcome must be checked through operation status');
function helperEntry(): string {
  const entry = [
    new URL('./restore-helper.js', import.meta.url),
    new URL('../../dist/restore-helper.js', import.meta.url),
  ].find((url) => existsSync(url));
  if (!entry) throw unavailable();
  return fileURLToPath(entry);
}
function deferred<Value>() {
  let resolve: (value: Value) => void = () => {};
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function stopChild(child: ChildProcess, exited: Promise<unknown>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined)
    return exited.then(() => {});
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    void exited.then(() => {
      clearTimeout(timer);
      resolve();
    });
    try {
      if (child.connected) child.send({ type: 'shutdown' }, () => {});
      else child.kill('SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  });
}
type Session = {
  child: ChildProcess;
  ready: ReturnType<typeof deferred<boolean>>;
  exited: ReturnType<typeof deferred<boolean>>;
  id: string | undefined;
  operation: RestoreHelperCommand['operation'] | undefined;
  reply: Exclude<RestoreHelperMessage, { type: 'ready' }> | undefined;
  failed: boolean;
  closing: Promise<void> | undefined;
};
function receive(session: Session, value: unknown): void {
  try {
    const message = decodeRestoreMessage(value);
    if (message.type === 'ready') {
      if (session.operation !== undefined) throw unavailable();
      session.ready.resolve(true);
      return;
    }
    if (!session.id || message.id !== session.id || session.reply) throw unavailable();
    if (
      message.type === 'result' &&
      (message.result === null) !== (session.operation === 'recover')
    )
      throw unavailable();
    session.reply = message;
  } catch {
    session.failed = true;
    session.ready.resolve(false);
    session.child.kill('SIGTERM');
  }
}
function createSession(): Session {
  const child = fork(helperEntry(), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    execArgv: [],
    serialization: 'json',
  });
  const session: Session = {
    child,
    ready: deferred<boolean>(),
    exited: deferred<boolean>(),
    id: undefined,
    operation: undefined,
    reply: undefined,
    failed: false,
    closing: undefined,
  };
  child.on('message', (value: unknown) => receive(session, value));
  child.once('error', () => {
    session.failed = true;
    session.ready.resolve(false);
    if (child.pid === undefined) session.exited.resolve(false);
  });
  child.once('exit', (code, signal) => {
    session.ready.resolve(false);
    session.exited.resolve(code === 0 && signal === null);
  });
  return session;
}
function closeSession(session: Session): Promise<void> {
  session.closing ??= stopChild(session.child, session.exited.promise);
  return session.closing;
}
function sendCommand(session: Session, command: RestoreHelperCommand): void {
  const fail = () => {
    session.failed = true;
    void closeSession(session);
  };
  try {
    session.child.send({ type: 'request', id: session.id, command }, (error) => {
      if (error) fail();
    });
  } catch {
    fail();
  }
}
async function request(
  session: Session,
  value: RestoreHelperCommand,
): Promise<RestoreResult | null> {
  const command = decodeRestoreCommand(value);
  if (session.id || session.failed || session.closing || !session.child.connected)
    throw unavailable();
  // Allocate identity synchronously, before any await, so concurrent callers cannot send twice.
  session.id = randomUUID();
  session.operation = command.operation;
  const timer = setTimeout(() => {
    session.failed = true;
    void closeSession(session);
  }, 300_000);
  try {
    sendCommand(session, command);
    const clean = await session.exited.promise;
    if (!clean || session.failed || !session.reply) throw unavailable();
    const reply = session.reply;
    if (reply.type === 'failure') {
      // The codec restricts these codes to the stable registry.
      throw domainError(
        reply.error.error.code,
        reply.error.error.message,
        reply.error.error.details,
      );
    }
    return reply.result;
  } finally {
    clearTimeout(timer);
  }
}

/** One helper handles one exclusive operation. A reply alone never releases the caller. */
export async function startRestoreHelper(options: { signal?: AbortSignal } = {}) {
  if (options.signal?.aborted) throw unavailable();
  const session = createSession();
  const abort = () => {
    session.failed = true;
    session.ready.resolve(false);
    void closeSession(session);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 10_000);
  const cleanup = () => options.signal?.removeEventListener('abort', abort);
  void session.exited.promise.then(cleanup);
  try {
    if (!(await session.ready.promise) || session.failed || options.signal?.aborted)
      throw unavailable();
  } catch (error) {
    await closeSession(session);
    cleanup();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return {
    request: (command: RestoreHelperCommand) => request(session, command),
    close: () => closeSession(session),
  };
}
export type RestoreHelper = Awaited<ReturnType<typeof startRestoreHelper>>;
