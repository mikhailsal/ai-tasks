import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod/mini';
import { successEnvelopeSchema } from '../../schema/envelopes.js';
import { backupEnvelopeSchema, recoveryJobEnvelopeSchema } from '../../schema/recovery.js';
import { slugSchema, uuidSchema } from '../../schema/values.js';
import { domainError, normalizeError } from '../errors.js';
import { actorSchema } from '../context.js';
import {
  canonicalManagedDirectory,
  ensureManagedDirectory,
  managedPath,
  missingFile,
  publishJson,
  readJson,
  recoveryCollection,
} from './files.js';

export const operationIdentitySchema = z
  .strictObject({
    database_epoch: uuidSchema,
    operation_id: uuidSchema,
    request_hash: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
    project_slug: slugSchema,
    actor: actorSchema,
    operation: z.enum(['backup.create', 'backup.restore']),
  })
  .check(
    z.refine(
      (identity) =>
        identity.actor === 'human-web' || identity.actor === `ai-cli:${identity.project_slug}`,
    ),
  );
export type OperationIdentity = z.output<typeof operationIdentitySchema>;
const receiptSchema = z.strictObject({
  version: z.literal(1),
  identity: operationIdentitySchema,
  result: successEnvelopeSchema,
});
const backupManifestSchema = z.strictObject({
  version: z.literal(1),
  identity: operationIdentitySchema,
  result: backupEnvelopeSchema,
});
const jobRecordSchema = z.strictObject({
  version: z.literal(1),
  identity: operationIdentitySchema,
  result: recoveryJobEnvelopeSchema,
});
export type BackupManifest = z.output<typeof backupManifestSchema>;
export type RecoveryJobRecord = z.output<typeof jobRecordSchema>;
export type OperationalReceipt = z.output<typeof receiptSchema>;

async function receiptPath(
  directory: string,
  identity: Pick<OperationIdentity, 'database_epoch' | 'operation_id'>,
  create = false,
) {
  const epochs = await recoveryCollection(directory, 'receipts', create);
  const epoch = uuidSchema.parse(identity.database_epoch);
  const operation = uuidSchema.parse(identity.operation_id);
  const parent = join(epochs, epoch);
  if (create) await ensureManagedDirectory(parent);
  else await canonicalManagedDirectory(parent);
  return join(parent, `${operation}.json`);
}
export async function findOperationalReceipt(options: {
  backupDirectory: string;
  identity: Pick<OperationIdentity, 'database_epoch' | 'operation_id' | 'request_hash'>;
}): Promise<OperationalReceipt | undefined> {
  let raw: unknown;
  try {
    raw = await readJson(await receiptPath(options.backupDirectory, options.identity));
  } catch (error) {
    if (missingFile(error)) return;
    throw normalizeError(error);
  }
  const parsed = receiptSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.identity.database_epoch !== options.identity.database_epoch ||
    parsed.data.identity.operation_id !== options.identity.operation_id
  )
    throw domainError('INTERNAL_ERROR', 'The stored recovery receipt is invalid');
  if (parsed.data.identity.request_hash !== options.identity.request_hash)
    throw domainError(
      'IDEMPOTENCY_CONFLICT',
      'Operation ID was already used with different content',
    );
  return parsed.data;
}
/** A no-replace atomic link picks one winner across independent processes. */
export async function publishOperationalReceipt(directory: string, value: OperationalReceipt) {
  const record = receiptSchema.parse(value);
  const path = await receiptPath(directory, record.identity, true);
  if (await publishJson(path, record)) return { record, published: true };
  const winner = await findOperationalReceipt({
    backupDirectory: directory,
    identity: record.identity,
  });
  if (!winner) throw domainError('INTERNAL_ERROR', 'The recovery receipt could not be published');
  return { record: winner, published: false };
}
export function backupSnapshotPath(options: { backupDirectory: string; backupId: string }): string {
  return managedPath(options.backupDirectory, 'snapshots', options.backupId, 'sqlite');
}
export async function writeBackupManifest(
  directory: string,
  manifest: BackupManifest,
): Promise<void> {
  const record = backupManifestSchema.parse(manifest);
  await recoveryCollection(directory, 'snapshots', true);
  if (!(await publishJson(managedPath(directory, 'snapshots', record.result.data.id), record)))
    throw domainError('INTERNAL_ERROR', 'The managed backup ID is already in use');
}
export async function readBackupManifest(directory: string, id: string): Promise<BackupManifest> {
  await recoveryCollection(directory, 'snapshots');
  let raw: unknown;
  try {
    raw = await readJson(managedPath(directory, 'snapshots', id));
  } catch (error) {
    if (missingFile(error))
      throw domainError('VALIDATION_ERROR', 'The managed backup does not exist');
    throw normalizeError(error);
  }
  const parsed = backupManifestSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.result.data.id !== id ||
    parsed.data.identity.operation !== 'backup.create'
  )
    throw domainError('INTERNAL_ERROR', 'The stored backup manifest is invalid');
  const receipt = await findOperationalReceipt({
    backupDirectory: directory,
    identity: parsed.data.identity,
  });
  if (!receipt) throw domainError('VALIDATION_ERROR', 'The managed backup has not been published');
  if (JSON.stringify(receipt.result) !== JSON.stringify(parsed.data.result))
    throw domainError('INTERNAL_ERROR', 'The backup manifest and receipt disagree');
  return parsed.data;
}
async function names(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (missingFile(error)) return [];
    throw normalizeError(error);
  }
}
/** Only winning published receipts expose snapshots; abandoned attempts stay invisible. */
export async function* publishedOperationalReceipts(directory: string) {
  const parent = await recoveryCollection(directory, 'receipts');
  for (const epoch of (await names(parent)).sort()) {
    if (!uuidSchema.safeParse(epoch).success) continue;
    const epochs = join(parent, epoch);
    await canonicalManagedDirectory(epochs);
    for (const name of (await names(epochs)).sort()) {
      if (!name.endsWith('.json') || !uuidSchema.safeParse(name.slice(0, -5)).success) continue;
      const record = receiptSchema.safeParse(await readJson(join(epochs, name)));
      if (
        !record.success ||
        record.data.identity.database_epoch !== epoch ||
        `${record.data.identity.operation_id}.json` !== name
      )
        throw domainError('INTERNAL_ERROR', 'The stored recovery receipt is invalid');
      yield record.data;
    }
  }
}
export async function* publishedBackupReceipts(directory: string) {
  for await (const record of publishedOperationalReceipts(directory)) {
    if (record.identity.operation !== 'backup.create') continue;
    const parsed = backupManifestSchema.safeParse(record);
    if (!parsed.success)
      throw domainError('INTERNAL_ERROR', 'The stored backup receipt is invalid');
    yield parsed.data;
  }
}
function validateJob(record: RecoveryJobRecord): void {
  const job = record.result.data;
  const terminal = job.state === 'succeeded' || job.state === 'failed';
  if (
    record.identity.operation !== 'backup.restore' ||
    job.operation_id !== record.identity.operation_id ||
    terminal !== (job.finished_at !== null) ||
    (job.state === 'succeeded') !== (job.result !== null) ||
    (job.state === 'failed') !== (job.error !== null)
  )
    throw domainError('INTERNAL_ERROR', 'The recovery job state is invalid');
}
export async function readRecoveryJob(options: {
  backupDirectory: string;
  jobId: string;
}): Promise<RecoveryJobRecord> {
  await recoveryCollection(options.backupDirectory, 'jobs');
  let raw: unknown;
  try {
    raw = await readJson(managedPath(options.backupDirectory, 'jobs', options.jobId));
  } catch (error) {
    if (missingFile(error))
      throw domainError('VALIDATION_ERROR', 'The recovery job does not exist');
    throw normalizeError(error);
  }
  const parsed = jobRecordSchema.safeParse(raw);
  if (!parsed.success || parsed.data.result.data.job_id !== options.jobId)
    throw domainError('INTERNAL_ERROR', 'The stored recovery job is invalid');
  validateJob(parsed.data);
  return parsed.data;
}
export async function writeRecoveryJob(directory: string, value: RecoveryJobRecord): Promise<void> {
  const record = jobRecordSchema.parse(value);
  validateJob(record);
  await recoveryCollection(directory, 'jobs', true);
  const path = managedPath(directory, 'jobs', record.result.data.job_id);
  if (await publishJson(path, record)) return;
  const existing = await readRecoveryJob({
    backupDirectory: directory,
    jobId: record.result.data.job_id,
  });
  if (
    JSON.stringify(existing.identity) !== JSON.stringify(record.identity) ||
    existing.result.data.started_at !== record.result.data.started_at
  )
    throw domainError('IDEMPOTENCY_CONFLICT', 'The recovery job identity cannot change');
  if (existing.result.data.state === 'succeeded' || existing.result.data.state === 'failed') {
    if (JSON.stringify(existing) !== JSON.stringify(record))
      throw domainError('IDEMPOTENCY_CONFLICT', 'The completed recovery job cannot change');
    return;
  }
  if (existing.result.data.state === 'running' && record.result.data.state === 'queued')
    throw domainError('INTERNAL_ERROR', 'The recovery job cannot move backwards');
  await publishJson(path, record, true);
}
export async function recoveryJobByOperation(directory: string, operationId: string) {
  const id = uuidSchema.parse(operationId);
  let found: RecoveryJobRecord | undefined;
  for await (const receipt of publishedOperationalReceipts(directory)) {
    if (receipt.identity.operation !== 'backup.restore' || receipt.identity.operation_id !== id)
      continue;
    if (found)
      throw domainError('VALIDATION_ERROR', 'The operation ID identifies multiple recovery jobs');
    const result = recoveryJobEnvelopeSchema.safeParse(receipt.result);
    if (!result.success)
      throw domainError('INTERNAL_ERROR', 'The stored recovery receipt is invalid');
    found = await readRecoveryJob({ backupDirectory: directory, jobId: result.data.data.job_id });
  }
  return found;
}
/** Publish the job before its unique operation mapping; only the winner may launch work. */
export async function claimRecoveryJob(directory: string, value: RecoveryJobRecord) {
  const record = jobRecordSchema.parse(value);
  if (record.result.data.state !== 'queued')
    throw domainError('INTERNAL_ERROR', 'A new recovery job must be queued');
  await writeRecoveryJob(directory, record);
  const outcome = await publishOperationalReceipt(directory, record);
  if (outcome.published) return { record, published: true };
  const winner = recoveryJobEnvelopeSchema.parse(outcome.record.result);
  if (winner.data.job_id !== record.result.data.job_id)
    await rm(managedPath(directory, 'jobs', record.result.data.job_id));
  return {
    record: await readRecoveryJob({ backupDirectory: directory, jobId: winner.data.job_id }),
    published: false,
  };
}
