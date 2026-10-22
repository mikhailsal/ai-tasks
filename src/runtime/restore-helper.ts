import {
  decodeRestoreRequest,
  decodeRestoreMessage,
  dispatchRestoreCommand,
  type RestoreHelperMessage,
} from '../core/recovery/command.js';
import { domainError, errorEnvelope } from '../core/errors.js';
import { runLocked } from './locked-entry.js';

function send(message: RestoreHelperMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send || !process.connected) return resolve();
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });
}

/** A one-shot private process. No database handle or lock exists at readiness. */
export async function runRestoreHelper(): Promise<void> {
  if (!process.send) throw domainError('MAINTENANCE', 'Recovery helper requires private IPC');
  let stopping = false;
  let used = false;
  let active: Promise<void> | undefined;
  let finish: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = () => {
    stopping = true;
    if (!active) finish();
  };
  const execute = async (request: ReturnType<typeof decodeRestoreRequest>) => {
    if (request.type === 'shutdown') return;
    let reply: RestoreHelperMessage;
    try {
      const result = await runLocked(
        { databasePath: request.command.databasePath, mode: 'exclusive', timeoutSeconds: 5 },
        (lock) => dispatchRestoreCommand(request.command, lock),
      );
      // runLocked has closed its descriptor before any outcome leaves this process.
      reply = { type: 'result', id: request.id, result };
    } catch (error) {
      reply = decodeRestoreMessage({
        type: 'failure',
        id: request.id,
        error: errorEnvelope(error),
      });
    }
    try {
      await send(reply);
    } finally {
      finish();
    }
  };
  const message = (value: unknown) => {
    try {
      const request = decodeRestoreRequest(value);
      if (request.type === 'shutdown') {
        stop();
        return;
      }
      if (stopping || used) {
        process.exitCode = 1;
        stop();
        return;
      }
      used = true;
      active = execute(request).catch(() => {
        process.exitCode = 1;
        finish();
      });
    } catch {
      process.exitCode = 1;
      stop();
    }
  };
  process.on('message', message);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('disconnect', stop);
  try {
    await send({ type: 'ready', version: 1 });
    await stopped;
    await active;
  } finally {
    process.off('message', message);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    process.off('disconnect', stop);
    if (process.connected) process.disconnect();
  }
}
