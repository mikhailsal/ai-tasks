import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { domainError } from '../core/errors.js';
import type { RestoreHelperCommand, RecoveryJobEnvelope } from '../core/recovery/command.js';
import {
  decodeRecoveryOwnerMessage,
  decodeStandaloneCommand,
} from '../core/recovery/standalone.js';

const unavailable = () =>
  domainError('MAINTENANCE', 'Restore acceptance is uncertain; query its operation status');
function ownerEntry(): string {
  const entry = [
    new URL('./recovery-owner.js', import.meta.url),
    new URL('../../dist/recovery-owner.js', import.meta.url),
  ].find((url) => existsSync(url));
  if (!entry) throw unavailable();
  return fileURLToPath(entry);
}
function detach(child: ChildProcess) {
  try {
    if (child.connected) child.disconnect();
  } catch {
    /* The owner may already have closed IPC. */
  }
  child.unref();
}

/** The detached owner, rather than the exiting CLI, retains the coordination mutex. */
export async function startStandaloneRestore(
  input: RestoreHelperCommand,
): Promise<RecoveryJobEnvelope> {
  const command = decodeStandaloneCommand(input);
  const child = fork(ownerEntry(), [], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    execArgv: [],
    serialization: 'json',
  });
  return new Promise((resolve, reject) => {
    let sent = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (receipt?: RecoveryJobEnvelope, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('message', message);
      child.off('exit', exit);
      // Preserve an error listener until this detached child is reaped.
      detach(child);
      if (receipt) resolve(receipt);
      else reject(error ?? unavailable());
    };
    const message = (value: unknown) => {
      try {
        const response = decodeRecoveryOwnerMessage(value);
        if (response.type === 'failure') {
          finish(
            undefined,
            domainError(
              response.error.error.code,
              response.error.error.message,
              response.error.error.details,
            ),
          );
          return;
        }
        if (response.type === 'accepted') {
          if (!sent || response.receipt.data.operation_id !== command.envelope.operation_id)
            throw unavailable();
          finish(response.receipt);
          return;
        }
        if (sent) throw unavailable();
        sent = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish(), 45_000);
        child.send({ type: 'request', id: randomUUID(), command }, (error) => {
          if (error) finish();
        });
      } catch {
        finish();
      }
    };
    const exit = () => finish();
    child.on('message', message);
    child.once('error', () => finish());
    child.once('exit', exit);
    timer = setTimeout(() => finish(), 10_000);
  });
}
