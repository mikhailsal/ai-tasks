import { and, desc, eq, type SQL } from 'drizzle-orm';
import {
  auditListInputSchema,
  auditPageEnvelopeSchema,
  auditResourceSchema,
  type AuditListInput,
} from '../../schema/audit.js';
import { auditRecords } from '../../schema/history.js';
import { jsonValueSchema, revisionSchema } from '../../schema/values.js';
import type { CoreContext } from '../database/types.js';
import { domainError } from '../errors.js';
import { formatTimestamp, readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { nextPageCursor, paginationContext, queryMetadata, queryState } from './page.js';
import { queryFingerprint } from './cursor.js';

type ReadContext = Pick<CoreContext, 'connection' | 'now'>;

function capturedRevision(snapshot: unknown): number | null {
  const value = jsonValueSchema.parse(snapshot);
  if (value === null || typeof value !== 'object' || !Object.hasOwn(value, 'revision')) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'revision');
  if (descriptor?.value === null || descriptor?.value === undefined) return null;
  return revisionSchema.parse(descriptor?.value);
}

export function auditResource(record: typeof auditRecords.$inferSelect) {
  try {
    return auditResourceSchema.parse({
      id: record.id,
      operation_id: record.operationId,
      project_slug: record.projectSlug,
      entity_type: record.entityType,
      entity_id: record.entityId,
      actor: record.actor,
      origin: record.origin,
      timestamp: formatTimestamp(record.timestamp),
      action: record.action,
      changes: record.changes,
      config_snapshot: record.configSnapshot,
      config_revision: capturedRevision(record.configSnapshot),
      confirmation: record.confirmation,
      database_epoch: record.databaseEpoch,
    });
  } catch {
    throw domainError('INTERNAL_ERROR', 'A stored audit record is invalid');
  }
}

/** History scope belongs to immutable records, including projects absent from live state. */
export function listAudit(context: ReadContext, input: AuditListInput) {
  const parsed = parseInput(auditListInputSchema, input);
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    const query = queryFingerprint({
      ...parsed,
      cursor: undefined,
      kind: 'audit',
      order: 'timestamp_desc_id_desc_v1',
    });
    const page = paginationContext({ state, query, now, cursor: parsed.cursor });
    const filters: SQL[] = [];
    if (parsed.project_slug !== undefined)
      filters.push(eq(auditRecords.projectSlug, parsed.project_slug));
    if (parsed.entity_id !== undefined) filters.push(eq(auditRecords.entityId, parsed.entity_id));
    if (parsed.operation_id !== undefined)
      filters.push(eq(auditRecords.operationId, parsed.operation_id));
    let rows: (typeof auditRecords.$inferSelect)[];
    try {
      rows = transaction
        .select()
        .from(auditRecords)
        .where(and(...filters))
        .orderBy(desc(auditRecords.timestamp), desc(auditRecords.id))
        .limit(parsed.limit + 1)
        .offset(page.offset)
        .all();
    } catch (error) {
      if (error instanceof SyntaxError)
        throw domainError('INTERNAL_ERROR', 'A stored audit record is invalid');
      throw error;
    }
    const items = rows.slice(0, parsed.limit).map(auditResource);
    const nextCursor =
      rows.length > parsed.limit
        ? nextPageCursor({ state, query, asOf: page.asOf, offset: page.offset + items.length })
        : null;
    return auditPageEnvelopeSchema.parse({
      ok: true,
      data: { items, next_cursor: nextCursor },
      meta: queryMetadata(state, now, page.asOf),
    });
  });
}
