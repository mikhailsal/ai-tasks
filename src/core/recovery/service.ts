import { randomUUID } from 'node:crypto';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { errorCodeSchema, errorDefinitions } from '../../schema/errors.js';
import { recoveryJobEnvelopeSchema } from '../../schema/recovery.js';
import { actorSchema, createContext } from '../context.js';
import { refuseUnresolvedRecovery } from '../database/lock-check.js';
import type { CoreContext } from '../database/types.js';
import { domainError, normalizeError } from '../errors.js';
import { formatTimestamp, readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { backupDirectory } from './files.js';
import { recoveryMutation } from './guards.js';
import {
  claimRecoveryJob,
  findOperationalReceipt,
  readRecoveryJob,
  type RecoveryJobRecord,
} from './manifests.js';
import { validateRestore } from './preconditions.js';
import { openRecoveryConnection, verifyRecoveryLock } from './connections.js';
import { prepareRestore, type RestoreOptions } from './prepare.js';
import { failRecoveryJob, runningRecoveryJob } from './jobs.js';
import { publishRestore } from './publish.js';
import { verifySnapshot } from './snapshot.js';
import type { BackupOptions } from './backup.js';

/** Acceptance stores only external operational metadata; ordinary domain state stays read-only. */
export async function acceptRestore(
  context: CoreContext,
  projectSlug: string,
  envelope: MutationEnvelope,
  options: BackupOptions = {},
) {
  try {
    // Epoch precedes even an exact receipt lookup; stale commands never restore again.
    const request = recoveryMutation(context, projectSlug, envelope, 'backup.restore');
    const directory = backupDirectory(context.connection.sqlite.name, options.backupDirectory);
    const receipt = await findOperationalReceipt({
      backupDirectory: directory,
      identity: request.identity,
    });
    if (receipt) {
      const accepted = recoveryJobEnvelopeSchema.parse(receipt.result);
      const record = await readRecoveryJob({
        backupDirectory: directory,
        jobId: accepted.data.job_id,
      });
      return { record, published: false };
    }
    verifySnapshot(context.connection.sqlite);
    const validated = await validateRestore(context, projectSlug, envelope, {
      backupDirectory: directory,
    });
    const timestamp = formatTimestamp(context.now());
    const record: RecoveryJobRecord = {
      version: 1,
      identity: validated.request.identity,
      result: recoveryJobEnvelopeSchema.parse({
        ok: true,
        meta: {
          ...validated.request.meta,
          now: timestamp,
          operation_id: request.input.operation_id,
          audit_ids: [],
        },
        data: {
          job_id: randomUUID(),
          operation_id: request.input.operation_id,
          state: 'queued',
          started_at: timestamp,
          finished_at: null,
          result: null,
          error: null,
        },
      }),
    };
    return await claimRecoveryJob(directory, record);
  } catch (error) {
    throw normalizeError(error);
  }
}

function completedResult(record: RecoveryJobRecord) {
  const job = record.result.data;
  if (job.state === 'succeeded' && job.result) return job.result;
  if (job.state === 'failed' && job.error) {
    const parsed = errorCodeSchema.safeParse(job.error.code);
    const code = parsed.success ? parsed.data : 'INTERNAL_ERROR';
    throw domainError(code, errorDefinitions[code].message, job.error.details);
  }
  return undefined;
}

async function acceptUnderLock(
  options: RestoreOptions,
  path: string,
  directory: string,
  now: () => number,
) {
  const connection = openRecoveryConnection({
    databasePath: path,
    lock: options.lock,
    role: 'read-live',
    now,
  });
  try {
    const context = createContext({
      connection,
      actor: parseInput(actorSchema, options.actor),
      now,
    });
    return await acceptRestore(context, options.projectSlug, options.envelope, {
      backupDirectory: directory,
    });
  } finally {
    connection.close();
  }
}

function phasePending(path: string): boolean {
  try {
    refuseUnresolvedRecovery(path);
    return false;
  } catch {
    return true;
  }
}

/** The caller owns the actual exclusive lifetime lock; this function never acquires runtime locks. */
export async function runRestore(options: RestoreOptions & { jobId?: string }) {
  const path = verifyRecoveryLock(options.databasePath, options.lock);
  refuseUnresolvedRecovery(path);
  const directory = backupDirectory(path, options.backupDirectory);
  const now = () => readClock(options.now ?? Date.now);
  let running: RecoveryJobRecord | undefined;
  try {
    const accepted = await acceptUnderLock(options, path, directory, now);
    const completed = completedResult(accepted.record);
    if (completed) return completed;
    const jobId = accepted.record.result.data.job_id;
    if (
      !accepted.published &&
      (options.jobId !== jobId || accepted.record.result.data.state !== 'queued')
    )
      throw domainError('MAINTENANCE', 'The accepted restore is available through job status', {
        job_id: jobId,
      });
    running = await runningRecoveryJob(directory, accepted.record);
    if (running.result.data.state !== 'running')
      throw domainError('MAINTENANCE', 'The recovery job is no longer executable');
    const prepared = await prepareRestore({
      ...options,
      databasePath: path,
      backupDirectory: directory,
      jobId,
      now,
    });
    return await publishRestore({
      databasePath: path,
      lock: options.lock,
      backupDirectory: directory,
      job: running,
      prepared,
      now,
      ...(options.failpoint === undefined ? {} : { failpoint: options.failpoint }),
    });
  } catch (error) {
    if (phasePending(path))
      throw domainError('MAINTENANCE', 'Recovery must finish before normal database access');
    if (running) await failRecoveryJob(directory, running, error, now);
    throw normalizeError(error);
  }
}
