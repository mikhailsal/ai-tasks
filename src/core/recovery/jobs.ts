import type { ResponseMeta } from '../../schema/envelopes.js';
import {
  recoveryJobEnvelopeSchema,
  restoreResultSchema,
  type RestoreResult,
} from '../../schema/recovery.js';
import { domainError, errorEnvelope } from '../errors.js';
import { formatTimestamp, readClock } from '../time.js';
import {
  publishedOperationalReceipts,
  readRecoveryJob,
  writeRecoveryJob,
  type RecoveryJobRecord,
} from './manifests.js';

async function currentJob(directory: string, record: RecoveryJobRecord) {
  const current = await readRecoveryJob({
    backupDirectory: directory,
    jobId: record.result.data.job_id,
  });
  const keys = [
    'database_epoch',
    'operation_id',
    'request_hash',
    'project_slug',
    'actor',
    'operation',
  ] as const;
  if (keys.some((key) => current.identity[key] !== record.identity[key]))
    throw domainError('IDEMPOTENCY_CONFLICT', 'The recovery job belongs to a different operation');
  return current;
}

export async function runningRecoveryJob(directory: string, record: RecoveryJobRecord) {
  const current = await currentJob(directory, record);
  if (current.result.data.state !== 'queued') return current;
  const next: RecoveryJobRecord = {
    ...current,
    result: { ...current.result, data: { ...current.result.data, state: 'running' } },
  };
  await writeRecoveryJob(directory, next);
  return next;
}

export async function completeRecoveryJob(
  directory: string,
  record: RecoveryJobRecord,
  options: {
    result: RestoreResult;
    meta: ResponseMeta;
    now?: () => number;
  },
) {
  const current = await currentJob(directory, record);
  const result = restoreResultSchema.parse(options.result);
  if (current.result.data.state === 'succeeded') {
    if (JSON.stringify(current.result.data.result) !== JSON.stringify(result))
      throw domainError('IDEMPOTENCY_CONFLICT', 'The completed recovery result cannot change');
    return current;
  }
  if (current.result.data.state === 'failed')
    throw domainError('MAINTENANCE', 'A failed recovery job cannot become successful');
  const timestamp = formatTimestamp(readClock(options.now ?? Date.now));
  const next: RecoveryJobRecord = {
    ...current,
    result: recoveryJobEnvelopeSchema.parse({
      ok: true,
      meta: {
        ...options.meta,
        now: timestamp,
        database_epoch: result.database_epoch,
        operation_id: current.identity.operation_id,
        audit_ids: result.audit_ids,
      },
      data: {
        ...current.result.data,
        state: 'succeeded',
        finished_at: timestamp,
        result,
        error: null,
      },
    }),
  };
  await writeRecoveryJob(directory, next);
  return next;
}

export async function failRecoveryJob(
  directory: string,
  record: RecoveryJobRecord,
  error: unknown,
  now: () => number = Date.now,
) {
  const current = await currentJob(directory, record);
  if (current.result.data.state === 'failed') return current;
  if (current.result.data.state === 'succeeded')
    throw domainError('MAINTENANCE', 'A successful recovery receipt cannot be replaced');
  const timestamp = formatTimestamp(readClock(now));
  const next: RecoveryJobRecord = {
    ...current,
    result: recoveryJobEnvelopeSchema.parse({
      ok: true,
      meta: { ...current.result.meta, now: timestamp },
      data: {
        ...current.result.data,
        state: 'failed',
        finished_at: timestamp,
        result: null,
        error: errorEnvelope(error).error,
      },
    }),
  };
  await writeRecoveryJob(directory, next);
  return next;
}

/** Startup calls this only while holding the exclusive live lock, before new acceptance. */
export async function sweepAbandonedJobs(
  directory: string,
  now: () => number = Date.now,
  activeJobId?: string,
): Promise<void> {
  for await (const receipt of publishedOperationalReceipts(directory)) {
    if (receipt.identity.operation !== 'backup.restore') continue;
    const accepted = recoveryJobEnvelopeSchema.parse(receipt.result);
    if (accepted.data.job_id === activeJobId) continue;
    const record = await readRecoveryJob({
      backupDirectory: directory,
      jobId: accepted.data.job_id,
    });
    if (record.result.data.state === 'queued' || record.result.data.state === 'running')
      await failRecoveryJob(
        directory,
        record,
        domainError('DB_CONFLICT', 'Recovery stopped before a verified publication was recorded'),
        now,
      );
  }
}
