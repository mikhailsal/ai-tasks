import { and, asc, eq, lt } from 'drizzle-orm';
import { occurrences } from '../../schema/recurrence.js';
import type { AuditEvent } from '../audit/append.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { readClock } from '../time.js';
import { occurrenceEvent, type OccurrenceRow } from './snapshots.js';

/** Expiry records the logical window boundary; the audit appender records processing time. */
export function expireOccurrence(
  transaction: DatabaseTransaction,
  options: { row: OccurrenceRow; now: number },
): { row: OccurrenceRow; events: AuditEvent[] } {
  const now = readClock(() => options.now);
  // Re-read within the caller's immediate transaction: repeated calls may carry an old
  // pending object after another step has already expired or completed this occurrence.
  const before = transaction
    .select()
    .from(occurrences)
    .where(eq(occurrences.id, options.row.id))
    .get();
  if (!before) throw domainError('INTERNAL_ERROR', 'An occurrence selected for expiry is missing');
  if (before.state !== 'pending' || now <= before.expiresAt) return { row: before, events: [] };
  const after = transaction
    .update(occurrences)
    .set({
      state: before.missPolicy === 'carry_forward' ? 'debt' : 'missed',
      missedAt: before.expiresAt,
      revision: before.revision + 1,
    })
    .where(eq(occurrences.id, before.id))
    .returning()
    .get();
  if (!after) throw domainError('INTERNAL_ERROR', 'Occurrence expiry returned no result');
  return { row: after, events: [occurrenceEvent(before, after, 'occurrence.miss')] };
}

/** Captured windows remain effective for historical generations and paused parents. */
export function expireTaskOccurrences(
  transaction: DatabaseTransaction,
  options: { taskId: string; now: number; limit?: number },
): { events: AuditEvent[]; processed: number; hasMore: boolean } {
  const now = readClock(() => options.now);
  const limit = options.limit ?? 128;
  if (!Number.isInteger(limit) || limit < 1 || limit > 128)
    throw domainError(
      'VALIDATION_ERROR',
      'Occurrence expiry limit must be an integer from 1 to 128',
    );
  const rows = transaction
    .select()
    .from(occurrences)
    .where(
      and(
        eq(occurrences.taskId, options.taskId),
        eq(occurrences.state, 'pending'),
        lt(occurrences.expiresAt, now),
      ),
    )
    .orderBy(asc(occurrences.expiresAt), asc(occurrences.id))
    .limit(limit + 1)
    .all();
  const events: AuditEvent[] = [];
  for (const row of rows.slice(0, limit)) {
    events.push(...expireOccurrence(transaction, { row, now }).events);
  }
  return { events, processed: events.length, hasMore: rows.length > limit };
}
