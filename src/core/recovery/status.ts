import { recoveryJobEnvelopeSchema, recoveryStatusInputSchema } from '../../schema/recovery.js';
import { domainError, normalizeError } from '../errors.js';
import { formatTimestamp, readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { readRecoveryJob, recoveryJobByOperation } from './manifests.js';

/** External manifests remain readable while every SQLite connection is closed. */
export async function getRecoveryStatus(options: {
  backupDirectory: string;
  jobId?: string;
  operationId?: string;
  now?: () => number;
}) {
  try {
    const query = parseInput(recoveryStatusInputSchema, {
      all_projects: true,
      ...(options.jobId === undefined ? {} : { job_id: options.jobId }),
      ...(options.operationId === undefined ? {} : { operation_id: options.operationId }),
    });
    const record =
      query.job_id !== undefined
        ? await readRecoveryJob({ backupDirectory: options.backupDirectory, jobId: query.job_id })
        : await recoveryJobByOperation(options.backupDirectory, query.operation_id ?? '');
    if (!record) throw domainError('VALIDATION_ERROR', 'The recovery operation does not exist');
    return recoveryJobEnvelopeSchema.parse({
      ...record.result,
      meta: { ...record.result.meta, now: formatTimestamp(readClock(options.now ?? Date.now)) },
    });
  } catch (error) {
    throw normalizeError(error);
  }
}
