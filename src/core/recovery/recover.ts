import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { recoveryJobEnvelopeSchema } from '../../schema/recovery.js';
import type { ConnectionLock } from '../database/lock-check.js';
import { domainError } from '../errors.js';
import { readClock } from '../time.js';
import { recoveryStagePath, verifyRecoveryLock } from './connections.js';
import { syncDirectory, syncFile } from './files.js';
import { completeRecoveryJob, failRecoveryJob, sweepAbandonedJobs } from './jobs.js';
import { publishedOperationalReceipts, readRecoveryJob } from './manifests.js';
import {
  assertPhaseJob,
  clearRecoveryPhase,
  readRecoveryPhase,
  recoveryMaintenance,
} from './phase.js';
import type { RecoveryFailpoint } from './prepare.js';
import { refuseUnexpectedWal, rollbackPublished, verifyRecoveryCopy } from './rollback.js';
import { configureRestoredLive, inspectRecoveryLive } from './verify-live.js';

export type RecoverDatabaseOptions = {
  databasePath: string;
  lock: ConnectionLock;
  backupDirectory: string;
  now?: () => number;
  failpoint?: RecoveryFailpoint;
  activeJobId?: string;
};
async function cleanupAbandonedStages(
  path: string,
  directory: string,
  activeJobId?: string,
): Promise<void> {
  for await (const receipt of publishedOperationalReceipts(directory)) {
    if (receipt.identity.operation !== 'backup.restore') continue;
    const accepted = recoveryJobEnvelopeSchema.parse(receipt.result);
    if (accepted.data.job_id === activeJobId) continue;
    const job = await readRecoveryJob({ backupDirectory: directory, jobId: accepted.data.job_id });
    if (job.result.data.state === 'queued' || job.result.data.state === 'running') continue;
    await rm(recoveryStagePath(path, job.result.data.job_id), { force: true });
  }
  await syncDirectory(dirname(path));
}
/** Holds no connection while deciding/replacing generations; the caller owns exclusive flock. */
export async function recoverDatabase(options: RecoverDatabaseOptions): Promise<void> {
  const path = verifyRecoveryLock(options.databasePath, options.lock);
  const now = () => readClock(options.now ?? Date.now);
  const phase = await readRecoveryPhase(path);
  if (!phase) {
    await sweepAbandonedJobs(options.backupDirectory, now, options.activeJobId);
    await cleanupAbandonedStages(path, options.backupDirectory, options.activeJobId);
    return;
  }
  try {
    const record = await readRecoveryJob({
      backupDirectory: options.backupDirectory,
      jobId: phase.job_id,
    });
    assertPhaseJob(phase, record);
    await verifyRecoveryCopy(options.backupDirectory, phase);
    // Opening even readonly SQLite can create SHM beside a WAL. Refuse unexpected
    // frames before touching that generation, preserving all evidence unchanged.
    await refuseUnexpectedWal(path);
    const current = inspectRecoveryLive({ databasePath: path, lock: options.lock, phase, now });
    if (current.state === 'new') {
      configureRestoredLive({ databasePath: path, lock: options.lock, now });
      await syncFile(path);
      await completeRecoveryJob(options.backupDirectory, record, {
        result: phase.result,
        meta: current.meta,
        now,
      });
    } else {
      // Terminal receipts are immutable. Never roll back a completed successful job.
      if (record.result.data.state === 'succeeded') throw recoveryMaintenance();
      if (current.state === 'invalid')
        await rollbackPublished({
          databasePath: path,
          lock: options.lock,
          backupDirectory: options.backupDirectory,
          phase,
          now,
          ...(options.failpoint === undefined ? {} : { failpoint: options.failpoint }),
        });
      configureRestoredLive({ databasePath: path, lock: options.lock, now });
      await syncFile(path);
      await failRecoveryJob(
        options.backupDirectory,
        record,
        domainError('DB_CONFLICT', 'Recovery stopped before a verified publication was completed'),
        now,
      );
    }
    await rm(recoveryStagePath(path, phase.job_id), { force: true });
    await clearRecoveryPhase(path);
    await sweepAbandonedJobs(options.backupDirectory, now, options.activeJobId);
    await cleanupAbandonedStages(path, options.backupDirectory, options.activeJobId);
  } catch {
    throw recoveryMaintenance();
  }
}
