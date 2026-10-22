import { dirname, join, resolve } from 'node:path';
import { domainError, errorEnvelope } from '../core/errors.js';
import { getRecoveryStatus } from '../core/recovery/status.js';
import { needsRecovery } from '../core/recovery/startup.js';
import {
  decodeRestoreRequest,
  type RestoreHelperCommand,
  type RecoveryJobEnvelope,
} from '../core/recovery/command.js';
import {
  acceptStandaloneRestore,
  decodeStandaloneCommand,
  decodeRecoveryOwnerMessage,
  type RecoveryOwnerMessage,
} from '../core/recovery/standalone.js';
import { coordinateRestore } from './supervisor-control.js';
import { runLocked } from './locked-entry.js';
import { startRestoreHelper } from './restore-helper-client.js';

function send(message: RecoveryOwnerMessage): Promise<void> {
  return new Promise((resolve) => {
    if (!process.connected || !process.send) return resolve();
    try {
      process.send(message, () => resolve());
    } catch {
      // Acceptance is durable. Losing the observer must never abandon ownership.
      resolve();
    }
  });
}
async function execute(command: RestoreHelperCommand, signal: AbortSignal) {
  const helper = await startRestoreHelper({ signal });
  try {
    return await helper.request(command);
  } finally {
    await helper.close();
  }
}
async function ownRestore(
  command: ReturnType<typeof decodeStandaloneCommand>,
  signal: AbortSignal,
) {
  const databasePath = resolve(command.databasePath);
  const paths = {
    databasePath,
    backupDirectory: resolve(command.backupDirectory ?? join(dirname(databasePath), 'backups')),
  };
  let acknowledged = false;
  const acknowledge = async (receipt: RecoveryJobEnvelope) => {
    acknowledged = true;
    await send({ type: 'accepted', receipt });
  };
  const result = await coordinateRestore({
    ...paths,
    projectSlug: command.projectSlug,
    envelope: command.envelope,
    startStandalone: async () => {
      if (await needsRecovery(paths.databasePath, paths.backupDirectory))
        await execute({ operation: 'recover', ...paths }, signal);
      const accepted = await runLocked(
        { databasePath, mode: 'shared', timeoutSeconds: 5 },
        (lock) => acceptStandaloneRestore({ ...command, ...paths }, lock),
      );
      await acknowledge(accepted.receipt);
      if (!accepted.published) return accepted.receipt;
      try {
        await execute({ ...command, ...paths, jobId: accepted.receipt.data.job_id }, signal);
      } catch {
        // The owner stays alive after its CLI disconnects; exclusive recovery is
        // the only authority for an uncertain publication, never the IPC outcome.
        if (await needsRecovery(paths.databasePath, paths.backupDirectory))
          await execute({ operation: 'recover', ...paths }, signal);
      }
      return getRecoveryStatus({
        backupDirectory: paths.backupDirectory,
        jobId: accepted.receipt.data.job_id,
      });
    },
  });
  if (!acknowledged) await acknowledge(result);
}

/** A detached owner retains coordination until accepted work settles, even without its CLI. */
export async function runRecoveryOwner(): Promise<void> {
  if (!process.send) throw domainError('MAINTENANCE', 'Recovery owner requires private IPC');
  const controller = new AbortController();
  let active: Promise<void> | undefined;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const idle = setTimeout(() => finish(), 10_000);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (!active) finish();
  };
  const message = (value: unknown) => {
    if (active) return;
    try {
      const request = decodeRestoreRequest(value);
      if (request.type === 'shutdown') {
        stop();
        return;
      }
      const command = decodeStandaloneCommand(request.command);
      clearTimeout(idle);
      deadline = setTimeout(() => controller.abort(), 300_000);
      active = ownRestore(command, controller.signal)
        .catch(async (error: unknown) => {
          process.exitCode = 1;
          await send(decodeRecoveryOwnerMessage({ type: 'failure', error: errorEnvelope(error) }));
        })
        .finally(finish);
    } catch {
      process.exitCode = 1;
      finish();
    }
  };
  process.on('message', message);
  process.on('disconnect', stop);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await send({ type: 'ready', version: 1 });
    await done;
    await active;
  } finally {
    clearTimeout(idle);
    clearTimeout(deadline);
    process.off('message', message);
    process.off('disconnect', stop);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    if (process.connected) process.disconnect();
  }
}
