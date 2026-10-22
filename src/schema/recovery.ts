import { z } from 'zod/mini';
import { successEnvelopeSchema, errorEnvelopeSchema } from './envelopes.js';
import {
  jsonValueSchema,
  revisionSchema,
  slugSchema,
  timestampSchema,
  uuidSchema,
} from './values.js';

const checksumSchema = z.string().check(z.regex(/^[0-9a-f]{64}$/u));
export const backupInfoSchema = z.strictObject({
  id: uuidSchema,
  created_at: timestampSchema,
  database_epoch: uuidSchema,
  schema_version: z.literal(1),
  checksum: checksumSchema,
  size_bytes: z.int().check(z.positive()),
  settings_revision: revisionSchema,
  projects: z.array(
    z.strictObject({
      project_slug: slugSchema,
      revision: revisionSchema,
      config_revision: revisionSchema,
    }),
  ),
});
export const backupCreateInputSchema = z.strictObject({});
export const backupListInputSchema = z.strictObject({
  all_projects: z.literal(true),
  limit: z._default(z.int().check(z.minimum(1), z.maximum(200)), 50),
  cursor: z.optional(z.string().check(z.minLength(1), z.maxLength(4096))),
});
export const affectedProjectSchema = z
  .strictObject({
    project_slug: slugSchema,
    expected_revision: z.nullable(revisionSchema),
    expected_config_revision: z.nullable(revisionSchema),
  })
  .check(
    z.refine(
      (project) =>
        (project.expected_revision === null) === (project.expected_config_revision === null),
      'Both current project revisions must be supplied together',
    ),
  );
export const backupValidationSchema = z.strictObject({
  backup: backupInfoSchema,
  compatible: z.literal(true),
  integrity: z.literal('ok'),
  affected_projects: z.array(affectedProjectSchema),
});
export const restoreInputSchema = z.strictObject({
  backup_id: uuidSchema,
  affected_projects: z.array(affectedProjectSchema),
  // The operational guard reports CONFIRMATION_REQUIRED for absent/invalid consent.
  confirmation: z.optional(jsonValueSchema),
});
export const restoreResultSchema = z.strictObject({
  database_epoch: uuidSchema,
  affected_projects: z.array(slugSchema),
  audit_ids: z.array(uuidSchema),
  recovery_snapshot_id: uuidSchema,
});
export const recoveryJobSchema = z.strictObject({
  job_id: uuidSchema,
  operation_id: uuidSchema,
  state: z.enum(['queued', 'running', 'succeeded', 'failed']),
  started_at: timestampSchema,
  finished_at: z.nullable(timestampSchema),
  result: z.nullable(restoreResultSchema),
  error: z.nullable(errorEnvelopeSchema.shape.error),
});
export const recoveryStatusInputSchema = z
  .strictObject({
    all_projects: z.literal(true),
    job_id: z.optional(uuidSchema),
    operation_id: z.optional(uuidSchema),
  })
  .check(
    z.refine(
      (input) => (input.job_id === undefined) !== (input.operation_id === undefined),
      'Supply exactly one job or operation ID',
    ),
  );
export const reservationConflictSchema = z.strictObject({
  reason: z.enum([
    'reservation_owner_mismatch',
    'project_marker_collision',
    'task_marker_collision',
  ]),
  emoji_key: z.string().check(z.minLength(1)),
  reservation_project_slug: slugSchema,
  conflicting_project_slug: slugSchema,
  entity_id: z.nullable(uuidSchema),
});
export const reservationConflictDetailsSchema = z.strictObject({
  conflicts: z.array(reservationConflictSchema).check(z.minLength(1)),
});
export const backupEnvelopeSchema = z.extend(successEnvelopeSchema, { data: backupInfoSchema });
export const backupListEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({ items: z.array(backupInfoSchema), next_cursor: z.nullable(z.string()) }),
});
export const backupValidationEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: backupValidationSchema,
});
export const recoveryJobEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: recoveryJobSchema,
});

export type BackupInfo = z.output<typeof backupInfoSchema>;
export type BackupValidation = z.output<typeof backupValidationSchema>;
export type AffectedProject = z.output<typeof affectedProjectSchema>;
export type RestoreInput = z.output<typeof restoreInputSchema>;
export type RestoreResult = z.output<typeof restoreResultSchema>;
export type RecoveryJob = z.output<typeof recoveryJobSchema>;
export type ReservationConflict = z.output<typeof reservationConflictSchema>;
export type BackupListInput = z.input<typeof backupListInputSchema>;
export type RecoveryStatusInput = z.input<typeof recoveryStatusInputSchema>;
export type BackupEnvelope = z.output<typeof backupEnvelopeSchema>;
export type BackupListEnvelope = z.output<typeof backupListEnvelopeSchema>;
export type BackupValidationEnvelope = z.output<typeof backupValidationEnvelopeSchema>;
export type RecoveryJobEnvelope = z.output<typeof recoveryJobEnvelopeSchema>;
