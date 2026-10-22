import * as z from 'zod/mini';
import { successEnvelopeSchema } from './envelopes.js';
import { confirmationSchema } from './tasks.js';
import {
  jsonValueSchema,
  revisionSchema,
  slugSchema,
  timestampSchema,
  uuidSchema,
} from './values.js';
export const auditListInputSchema = z
  .strictObject({
    project_slug: z.optional(slugSchema),
    all_projects: z.optional(z.literal(true)),
    entity_id: z.optional(uuidSchema),
    operation_id: z.optional(uuidSchema),
    limit: z._default(z.int().check(z.minimum(1)).check(z.maximum(200)), 50),
    cursor: z.optional(z.string().check(z.minLength(1)).check(z.maxLength(4096))),
  })
  .check(
    z.refine(
      (input) => (input.project_slug !== undefined) !== (input.all_projects !== undefined),
      'Supply exactly one explicit project scope',
    ),
  );
const auditActorSchema = z
  .string()
  .check(
    z.refine(
      (actor) =>
        actor === 'human-web' ||
        (actor.startsWith('ai-cli:') && slugSchema.safeParse(actor.slice(7)).success),
      'Audit actor must identify a supported application caller',
    ),
  );
export const auditResourceSchema = z.strictObject({
  id: uuidSchema,
  operation_id: uuidSchema,
  project_slug: slugSchema,
  entity_type: z.string().check(z.minLength(1)),
  entity_id: uuidSchema,
  actor: auditActorSchema,
  origin: z.string().check(z.minLength(1)),
  timestamp: timestampSchema,
  action: z.string().check(z.minLength(1)),
  changes: z.array(
    z.strictObject({ field: z.string(), before: jsonValueSchema, after: jsonValueSchema }),
  ),
  config_snapshot: jsonValueSchema,
  config_revision: z.nullable(revisionSchema),
  confirmation: z.nullable(confirmationSchema),
  database_epoch: uuidSchema,
});
export const auditPageEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({
    items: z.array(auditResourceSchema),
    next_cursor: z.nullable(z.string()),
  }),
});
export type AuditResource = z.infer<typeof auditResourceSchema>;
export type AuditListInput = z.input<typeof auditListInputSchema>;
export type AuditPageEnvelope = z.infer<typeof auditPageEnvelopeSchema>;
