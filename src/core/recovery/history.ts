import type Database from 'better-sqlite3';
import * as z from 'zod/mini';
import { domainError } from '../errors.js';
import { jsonValueSchema } from '../../schema/values.js';
import { auditResource } from '../queries/audit.js';

const auditRowSchema = z.strictObject({
  id: z.string(),
  operation_id: z.string(),
  project_slug: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  actor: z.string(),
  origin: z.string(),
  timestamp: z.number(),
  action: z.string(),
  changes: z.string(),
  config_snapshot: z.nullable(z.string()),
  confirmation: z.nullable(z.string()),
  database_epoch: z.string(),
});
export type RawAuditRecord = z.output<typeof auditRowSchema>;

export function readRawAuditRecords(sqlite: Database.Database): RawAuditRecord[] {
  const rows: unknown = sqlite
    .prepare(
      `SELECT id, operation_id, project_slug, entity_type, entity_id, actor, origin,
              timestamp, action, changes, config_snapshot, confirmation, database_epoch
       FROM audit_records ORDER BY id`,
    )
    .all();
  return z.array(auditRowSchema).parse(rows);
}

export function* iterateRawAuditRecords(sqlite: Database.Database): Iterable<RawAuditRecord> {
  const rows = sqlite
    .prepare(
      `SELECT id, operation_id, project_slug, entity_type, entity_id, actor, origin,
              timestamp, action, changes, config_snapshot, confirmation, database_epoch
       FROM audit_records ORDER BY id`,
    )
    .iterate();
  for (const row of rows) yield auditRowSchema.parse(row);
}

function auditJson(source: string | null) {
  return source === null ? null : jsonValueSchema.parse(JSON.parse(source));
}

/** Preflight every stored value using the same semantics as public historical reads.
 * Raw strings remain unchanged for byte-exact union and duplicate-ID comparison. */
export function assertReadableAuditRecords(sqlite: Database.Database): void {
  try {
    for (const row of iterateRawAuditRecords(sqlite)) {
      auditResource({
        id: row.id,
        operationId: row.operation_id,
        projectSlug: row.project_slug,
        entityType: row.entity_type,
        entityId: row.entity_id,
        actor: row.actor,
        origin: row.origin,
        timestamp: row.timestamp,
        action: row.action,
        changes: auditJson(row.changes),
        configSnapshot: auditJson(row.config_snapshot),
        confirmation: auditJson(row.confirmation),
        databaseEpoch: row.database_epoch,
      });
    }
  } catch {
    throw domainError('INTERNAL_ERROR', 'Current audit history is unavailable');
  }
}

/** Rejects an ID collision unless every persisted audit field is byte-for-byte equal. */
export function assertNoDivergentAuditIds(
  liveSqlite: Database.Database,
  snapshotSqlite: Database.Database,
): void {
  const liveById = liveSqlite.prepare(
    `SELECT id, operation_id, project_slug, entity_type, entity_id, actor, origin,
            timestamp, action, changes, config_snapshot, confirmation, database_epoch
     FROM audit_records WHERE id = ?`,
  );
  for (const snapshotRow of iterateRawAuditRecords(snapshotSqlite)) {
    const liveValue: unknown = liveById.get(snapshotRow.id);
    const liveRow = liveValue === undefined ? undefined : auditRowSchema.parse(liveValue);
    if (liveRow && JSON.stringify(liveRow) !== JSON.stringify(snapshotRow)) {
      throw domainError('INTERNAL_ERROR', 'Recovery snapshot contains a divergent audit record');
    }
  }
}
