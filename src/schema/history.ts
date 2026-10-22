import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  integerConstraint,
  jsonConstraint,
  slugConstraint,
  uuidConstraint,
} from './constraints.js';
import type { JsonValue } from './values.js';

function actorConstraint(actor: SQLWrapper): SQL {
  return sql`${actor} = 'human-web' OR (
    substr(${actor}, 1, 7) = 'ai-cli:'
    AND ${slugConstraint(sql`substr(${actor}, 8)`)})`;
}

// Deliberately no live entity/project FKs: restore retains historical snapshots even
// when the corresponding live entity is absent. Migration triggers enforce append-only
// history; neither table has a TTL or application deletion path.
export const auditRecords = sqliteTable(
  'audit_records',
  {
    id: text('id').primaryKey().notNull(),
    operationId: text('operation_id').notNull(),
    projectSlug: text('project_slug').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    actor: text('actor').notNull(),
    origin: text('origin').notNull().default('cli'),
    timestamp: integer('timestamp').notNull(),
    action: text('action').notNull(),
    changes: text('changes', { mode: 'json' }).$type<JsonValue>().notNull(),
    configSnapshot: text('config_snapshot', { mode: 'json' }).$type<JsonValue>(),
    confirmation: text('confirmation', { mode: 'json' }).$type<JsonValue>(),
    databaseEpoch: text('database_epoch').notNull(),
  },
  (table) => [
    check('audit_records_id_uuid', uuidConstraint(table.id)),
    check('audit_records_operation_id_uuid', uuidConstraint(table.operationId)),
    check('audit_records_database_epoch_uuid', uuidConstraint(table.databaseEpoch)),
    check('audit_records_project_slug_valid', slugConstraint(table.projectSlug)),
    check('audit_records_actor_valid', actorConstraint(table.actor)),
    check('audit_records_timestamp_integer', integerConstraint(table.timestamp)),
    check('audit_records_entity_type_nonempty', sql`length(${table.entityType}) > 0`),
    check('audit_records_entity_id_uuid', uuidConstraint(table.entityId)),
    check('audit_records_action_nonempty', sql`length(${table.action}) > 0`),
    check('audit_records_origin_nonempty', sql`length(${table.origin}) > 0`),
    check('audit_records_changes_json', jsonConstraint(table.changes)),
    check('audit_records_changes_array', sql`json_type(${table.changes}) = 'array'`),
    check('audit_records_config_snapshot_json', jsonConstraint(table.configSnapshot)),
    check('audit_records_confirmation_json', jsonConstraint(table.confirmation)),
    // Scoped history pagination uses timestamp/id descending; operation lookup supports
    // lost-response diagnostics without scanning the full immutable event history.
    index('audit_records_project_timestamp_id_idx').on(
      table.projectSlug,
      sql`${table.timestamp} DESC`,
      sql`${table.id} DESC`,
    ),
    index('audit_records_operation_id_idx').on(table.operationId),
  ],
);

export const operationReceipts = sqliteTable(
  'operation_receipts',
  {
    databaseEpoch: text('database_epoch').notNull(),
    operationId: text('operation_id').notNull(),
    requestHash: text('request_hash').notNull(),
    actor: text('actor').notNull(),
    projectSlug: text('project_slug').notNull(),
    operation: text('operation').notNull(),
    result: text('result', { mode: 'json' }).$type<JsonValue>().notNull(),
    auditIds: text('audit_ids', { mode: 'json' }).$type<JsonValue>().notNull(),
    committedAt: integer('committed_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.databaseEpoch, table.operationId] }),
    check('operation_receipts_database_epoch_uuid', uuidConstraint(table.databaseEpoch)),
    check('operation_receipts_operation_id_uuid', uuidConstraint(table.operationId)),
    check(
      'operation_receipts_request_hash_sha256',
      sql`length(${table.requestHash}) = 64 AND ${table.requestHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check('operation_receipts_actor_valid', actorConstraint(table.actor)),
    check('operation_receipts_project_slug_valid', slugConstraint(table.projectSlug)),
    check('operation_receipts_operation_nonempty', sql`length(${table.operation}) > 0`),
    check('operation_receipts_result_json', jsonConstraint(table.result)),
    check('operation_receipts_audit_ids_json', jsonConstraint(table.auditIds)),
    check('operation_receipts_audit_ids_array', sql`json_type(${table.auditIds}) = 'array'`),
    check('operation_receipts_committed_at_integer', integerConstraint(table.committedAt)),
  ],
);
