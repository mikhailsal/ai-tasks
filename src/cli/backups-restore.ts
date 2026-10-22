import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { domainError } from '../core/errors.js';
import { errorCodeSchema } from '../schema/errors.js';
import type { MutationEnvelope } from '../schema/envelopes.js';
import type { RecoveryJobEnvelope } from '../schema/recovery.js';
import { getRecoveryStatus } from '../core/recovery/status.js';
import { needsRecovery } from '../core/recovery/startup.js';
import { coordinateRestore } from '../runtime/supervisor-control.js';
import { startRestoreHelper } from '../runtime/restore-helper-client.js';
import { startStandaloneRestore } from '../runtime/recovery-owner-client.js';

export function backupPaths() {
  const databasePath = resolve(process.env.AI_TASKS_DB_PATH ?? 'data/ai-tasks.sqlite');
  return {
    databasePath,
    backupDirectory: resolve(
      process.env.AI_TASKS_BACKUP_DIR ?? join(dirname(databasePath), 'backups'),
    ),
  };
}
async function execute(
  command: Parameters<Awaited<ReturnType<typeof startRestoreHelper>>['request']>[0],
) {
  const helper = await startRestoreHelper();
  try {
    return await helper.request(command);
  } finally {
    await helper.close();
  }
}
export function terminalRecoveryJob(receipt: RecoveryJobEnvelope): RecoveryJobEnvelope {
  if (receipt.data.state === 'failed' && receipt.data.error) {
    const error = receipt.data.error;
    throw domainError(errorCodeSchema.parse(error.code), error.message, error.details);
  }
  return receipt;
}
async function standaloneRestore(projectSlug: string, envelope: MutationEnvelope) {
  const paths = backupPaths();
  if (await needsRecovery(paths.databasePath, paths.backupDirectory))
    await execute({ operation: 'recover', ...paths });
  try {
    await execute({
      operation: 'restore',
      ...paths,
      projectSlug,
      envelope,
      actor: `ai-cli:${projectSlug}`,
    });
  } catch (error) {
    if (!(await needsRecovery(paths.databasePath, paths.backupDirectory))) throw error;
    await execute({ operation: 'recover', ...paths });
  }
  return getRecoveryStatus({
    backupDirectory: paths.backupDirectory,
    operationId: envelope.operation_id,
  });
}
export async function waitForRecoveryJob(receipt: RecoveryJobEnvelope, backupDirectory: string) {
  const deadline = performance.now() + 300_000;
  let current = receipt;
  while (current.data.state === 'queued' || current.data.state === 'running') {
    if (performance.now() >= deadline)
      throw domainError('MAINTENANCE', 'Restore is still running; query its operation status', {
        operation_id: receipt.data.operation_id,
      });
    await delay(100);
    current = await getRecoveryStatus({ backupDirectory, jobId: receipt.data.job_id });
  }
  return terminalRecoveryJob(current);
}
export async function restoreFromCli(projectSlug: string, envelope: MutationEnvelope, wait = true) {
  const paths = backupPaths();
  if (!wait)
    return startStandaloneRestore({
      operation: 'restore',
      ...paths,
      projectSlug,
      envelope,
      actor: `ai-cli:${projectSlug}`,
    });
  const accepted = await coordinateRestore({
    ...paths,
    projectSlug,
    envelope,
    startStandalone: () => standaloneRestore(projectSlug, envelope),
  });
  return waitForRecoveryJob(accepted, paths.backupDirectory);
}
