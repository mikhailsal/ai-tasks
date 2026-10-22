import { z } from 'zod/mini';
import { priorityValueSchema, projectConfigInputSchema } from './configuration.js';
import { errorCodeSchema } from './errors.js';
import { mutationSuccessEnvelopeSchema, successEnvelopeSchema } from './envelopes.js';
import { configKeySchema, revisionSchema, uuidSchema } from './values.js';
export const statusMappingSchema = z.strictObject({
  kind: z.enum(['ordinary', 'recurring']),
  from_status_id: configKeySchema,
  to_status_id: configKeySchema,
});
export const configurationMigrationSchema = z.strictObject({
  config: projectConfigInputSchema,
  status_mappings: z.array(statusMappingSchema),
  priority_mappings: z.array(
    z.strictObject({ from: priorityValueSchema, to: priorityValueSchema }),
  ),
  affected_tasks: z.array(
    z.strictObject({ task_id: uuidSchema, expected_revision: revisionSchema }),
  ),
});
export const migrationIssueSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string(),
  task_id: z.optional(uuidSchema),
});
export const configurationPreviewSchema = z.strictObject({
  affected_tasks: z.array(
    z.strictObject({ task_id: uuidSchema, expected_revision: revisionSchema }),
  ),
  required_status_mappings: z.array(z.omit(statusMappingSchema, { to_status_id: true })),
  required_priority_mappings: z.array(z.strictObject({ from: priorityValueSchema })),
  issues: z.array(migrationIssueSchema),
});
export const configurationPreviewEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: configurationPreviewSchema,
});
export const configurationMigrationEnvelopeSchema = z.extend(mutationSuccessEnvelopeSchema, {
  data: z.strictObject({
    config: z.extend(projectConfigInputSchema, { revision: revisionSchema }),
    affected_tasks: z.array(z.strictObject({ task_id: uuidSchema, revision: revisionSchema })),
  }),
});
export type ConfigurationMigration = z.infer<typeof configurationMigrationSchema>;
export type MigrationIssue = z.infer<typeof migrationIssueSchema>;
