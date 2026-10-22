import { randomUUID } from 'node:crypto';
import * as z from 'zod/mini';
import { auditRecords } from '../../schema/history.js';
import { jsonValueSchema, uuidSchema } from '../../schema/values.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
export const auditEventSchema = z.strictObject({
  entity_type: z.string().check(z.minLength(1)),
  entity_id: uuidSchema,
  action: z.string().check(z.minLength(1)),
  changes: z.array(
    z.strictObject({
      field: z.string(),
      before: jsonValueSchema,
      after: jsonValueSchema,
    }),
  ),
  config_snapshot: z.optional(z.nullable(jsonValueSchema)),
  confirmation: z.optional(
    z.nullable(
      z.strictObject({
        asserted: z.literal(true),
        // Validate meaningful text without replacing the exact supplied confirmation.
        user_text: z
          .string()
          .check(z.refine((value) => value.trim().length > 0, 'Confirmation text is required')),
      }),
    ),
  ),
});
export type AuditEvent = z.input<typeof auditEventSchema>;
export function appendAudit(
  transaction: DatabaseTransaction,
  options: {
    context: CoreContext;
    operationId: string;
    projectSlug: string;
    databaseEpoch: string;
    timestamp: number;
    events: AuditEvent[];
  },
): string[] {
  if (options.events.length === 0) {
    throw domainError(
      'VALIDATION_ERROR',
      'A successful mutation must record at least one audit event',
    );
  }
  const events = z.array(auditEventSchema).parse(options.events);
  const rows = events.map((event) => ({
    id: randomUUID(),
    operationId: options.operationId,
    projectSlug: options.projectSlug,
    entityType: event.entity_type,
    entityId: event.entity_id,
    actor: options.context.actor,
    origin: options.context.origin,
    timestamp: options.timestamp,
    action: event.action,
    changes: event.changes,
    configSnapshot: event.config_snapshot ?? null,
    confirmation: event.confirmation ?? null,
    databaseEpoch: options.databaseEpoch,
  }));
  // Thirteen bound columns per row: keep each statement below even a 999-variable
  // SQLite build's limit. The caller's transaction still commits every batch together.
  const batchSize = 64;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    transaction
      .insert(auditRecords)
      .values(rows.slice(offset, offset + batchSize))
      .run();
  }
  return rows.map((row) => row.id);
}
