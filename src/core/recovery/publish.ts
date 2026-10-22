import { rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ConnectionLock } from '../database/lock-check.js';
import { normalizeError } from '../errors.js';
import { readClock } from '../time.js';
import { recoveryStagePath, verifyRecoveryLock } from './connections.js';
import { fileChecksum, syncDirectory, syncFile } from './files.js';
import { completeRecoveryJob } from './jobs.js';
import type { RecoveryJobRecord } from './manifests.js';
import type { PreparedRestore, RecoveryFailpoint } from './prepare.js';
import {
  assertPhaseJob,
  clearRecoveryPhase,
  recoveryMaintenance,
  validateRecoveryPhase,
  writeRecoveryPhase,
} from './phase.js';
import { inspectRecoveryLive, configureRestoredLive } from './verify-live.js';

export type PublishRestoreOptions = {
  databasePath: string;
  lock: ConnectionLock;
  backupDirectory: string;
  job: RecoveryJobRecord;
  prepared: PreparedRestore;
  now?: () => number;
  failpoint?: RecoveryFailpoint;
};
/** Every SQLite handle is closed when the single same-filesystem rename replaces live. */
export async function publishRestore(options: PublishRestoreOptions) {
  try {
    const path = verifyRecoveryLock(options.databasePath, options.lock);
    const now = () => readClock(options.now ?? Date.now);
    const prepared = options.prepared;
    const phase = validateRecoveryPhase({
      version: 1,
      job_id: options.job.result.data.job_id,
      identity: prepared.identity,
      old_backup: prepared.recovery,
      new_epoch: prepared.result.database_epoch,
      stage_checksum: prepared.stageChecksum,
      result: prepared.result,
      meta: prepared.meta,
      previous_meta: prepared.previousMeta,
    });
    assertPhaseJob(phase, options.job);
    const stage = recoveryStagePath(path, phase.job_id);
    if (stage !== prepared.stagePath) throw recoveryMaintenance();
    await writeRecoveryPhase(path, phase, options.failpoint);
    await options.failpoint?.('publish.before_replace');
    if ((await fileChecksum(stage)) !== phase.stage_checksum) throw recoveryMaintenance();
    await rename(stage, path);
    await options.failpoint?.('publish.after_replace');
    await options.failpoint?.('publish.before_directory_sync');
    await syncDirectory(dirname(path));
    await options.failpoint?.('publish.after_directory_sync');
    await options.failpoint?.('reopen.before_open');
    const verified = inspectRecoveryLive({ databasePath: path, lock: options.lock, phase, now });
    if (verified.state !== 'new') throw recoveryMaintenance();
    configureRestoredLive({ databasePath: path, lock: options.lock, now });
    await syncFile(path);
    await options.failpoint?.('reopen.after_verify');
    await completeRecoveryJob(options.backupDirectory, options.job, {
      result: phase.result,
      meta: verified.meta,
      now,
    });
    await options.failpoint?.('receipt.after_sync');
    await clearRecoveryPhase(path);
    return phase.result;
  } catch (error) {
    throw normalizeError(error);
  }
}
