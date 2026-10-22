import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as z from 'zod/mini';
import { responseMetaSchema } from '../../schema/envelopes.js';
import { backupInfoSchema, restoreResultSchema } from '../../schema/recovery.js';
import { uuidSchema } from '../../schema/values.js';
import { RECOVERY_MANIFEST_SUFFIX } from '../database/lock-check.js';
import { domainError } from '../errors.js';
import { missingFile, publishJson, readJson, syncDirectory } from './files.js';
import { operationIdentitySchema, type RecoveryJobRecord } from './manifests.js';
import type { RecoveryFailpoint } from './prepare.js';

const phaseSchema = z.strictObject({
  version: z.literal(1),
  job_id: uuidSchema,
  identity: operationIdentitySchema,
  old_backup: backupInfoSchema,
  new_epoch: uuidSchema,
  stage_checksum: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  result: restoreResultSchema,
  meta: responseMetaSchema,
  previous_meta: responseMetaSchema,
});
export type RecoveryPhase = z.output<typeof phaseSchema>;
export function recoveryMaintenance() {
  return domainError('MAINTENANCE', 'Database recovery requires a verified maintenance decision');
}
function assertEpochs(phase: RecoveryPhase): void {
  if (
    phase.identity.operation !== 'backup.restore' ||
    phase.identity.database_epoch !== phase.previous_meta.database_epoch ||
    phase.old_backup.database_epoch !== phase.previous_meta.database_epoch ||
    phase.new_epoch === phase.previous_meta.database_epoch
  )
    throw recoveryMaintenance();
  if (
    phase.result.database_epoch !== phase.new_epoch ||
    phase.meta.database_epoch !== phase.new_epoch ||
    phase.result.recovery_snapshot_id !== phase.old_backup.id
  )
    throw recoveryMaintenance();
}
function assertResult(phase: RecoveryPhase): void {
  const scopes = phase.result.affected_projects;
  const ids = phase.result.audit_ids;
  if (
    new Set(scopes).size !== scopes.length ||
    new Set(ids).size !== ids.length ||
    ids.length !== scopes.length ||
    scopes.length === 0
  )
    throw recoveryMaintenance();
  if (!phase.old_backup.projects.every((project) => scopes.includes(project.project_slug)))
    throw recoveryMaintenance();
}
function assertMetadata(phase: RecoveryPhase): void {
  if (phase.meta.read_revision === undefined || phase.previous_meta.read_revision === undefined)
    throw recoveryMaintenance();
  if (phase.meta.read_revision <= phase.previous_meta.read_revision) throw recoveryMaintenance();
  if (
    phase.meta.operation_id !== undefined &&
    phase.meta.operation_id !== phase.identity.operation_id
  )
    throw recoveryMaintenance();
  if (
    phase.meta.audit_ids !== undefined &&
    JSON.stringify(phase.meta.audit_ids) !== JSON.stringify(phase.result.audit_ids)
  )
    throw recoveryMaintenance();
}
export function validateRecoveryPhase(value: unknown): RecoveryPhase {
  const parsed = phaseSchema.safeParse(value);
  if (!parsed.success) throw recoveryMaintenance();
  assertEpochs(parsed.data);
  assertResult(parsed.data);
  assertMetadata(parsed.data);
  return parsed.data;
}
export function assertPhaseJob(phase: RecoveryPhase, record: RecoveryJobRecord): void {
  const identity = operationIdentitySchema.parse(record.identity);
  if (
    record.result.data.job_id !== phase.job_id ||
    JSON.stringify(identity) !== JSON.stringify(phase.identity)
  )
    throw recoveryMaintenance();
}
export function recoveryPhasePath(databasePath: string): string {
  return `${databasePath}${RECOVERY_MANIFEST_SUFFIX}`;
}
export async function readRecoveryPhase(databasePath: string): Promise<RecoveryPhase | undefined> {
  let value: unknown;
  try {
    value = await readJson(recoveryPhasePath(databasePath));
  } catch (error) {
    if (missingFile(error)) return;
    throw recoveryMaintenance();
  }
  return validateRecoveryPhase(value);
}
export async function writeRecoveryPhase(
  databasePath: string,
  value: RecoveryPhase,
  failpoint?: RecoveryFailpoint,
): Promise<void> {
  const phase = validateRecoveryPhase(value);
  await failpoint?.('manifest.before_sync');
  if (!(await publishJson(recoveryPhasePath(databasePath), phase))) throw recoveryMaintenance();
  await failpoint?.('manifest.after_sync');
}
export async function clearRecoveryPhase(databasePath: string): Promise<void> {
  await rm(recoveryPhasePath(databasePath));
  await syncDirectory(dirname(databasePath));
}
