import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  claimRecoveryJob,
  readRecoveryJob,
  type RecoveryJobRecord,
} from '../../src/core/recovery/manifests.js';

/** Simulate an exported operator backup directory using only owned test data. */
export async function inheritedBackups(directory: string) {
  const backupDirectory = join(directory, 'inherited-backups');
  const operationId = randomUUID();
  const epoch = randomUUID();
  const jobId = randomUUID();
  const timestamp = '2026-10-22T00:00:00.000Z';
  const record: RecoveryJobRecord = {
    version: 1,
    identity: {
      database_epoch: epoch,
      operation_id: operationId,
      request_hash: 'a'.repeat(64),
      project_slug: 'alpha',
      actor: 'human-web',
      operation: 'backup.restore',
    },
    result: {
      ok: true,
      data: {
        job_id: jobId,
        operation_id: operationId,
        state: 'queued',
        started_at: timestamp,
        finished_at: null,
        result: null,
        error: null,
      },
      meta: {
        database_epoch: epoch,
        timezone: 'Europe/Moscow',
        now: timestamp,
        operation_id: operationId,
        audit_ids: [],
      },
    },
  };
  await claimRecoveryJob(backupDirectory, record);
  return {
    environment: { AI_TASKS_BACKUP_DIR: backupDirectory },
    record,
    read: () => readRecoveryJob({ backupDirectory, jobId }),
  };
}
