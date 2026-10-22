import { eq } from 'drizzle-orm';
import type { tasks } from '../../schema/entities.js';
import { recurrenceState, type scheduleGenerations } from '../../schema/recurrence.js';
import type { AfterCompletionSchedule } from '../../schema/recurrence-input.js';
import type { AuditEvent } from '../audit/append.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { nextElapsedDeadline } from './elapsed.js';
import { expireOccurrence } from './expire.js';
import { materializeOccurrence, type OccurrenceRow } from './snapshots.js';

/** Only the current generation's caller reaches this helper; no synthetic completion chain. */
export function createCompletionSuccessor(
  transaction: DatabaseTransaction,
  options: {
    task: typeof tasks.$inferSelect;
    generation: typeof scheduleGenerations.$inferSelect;
    schedule: AfterCompletionSchedule;
    predecessor: OccurrenceRow;
    now: number;
    active: boolean;
  },
): { events: AuditEvent[] } {
  const actual = options.predecessor.actualCompletedAt;
  if (actual === null)
    throw domainError('INTERNAL_ERROR', 'A successor requires real actual completion');
  const deadline = nextElapsedDeadline({ schedule: options.schedule, actualCompletedAt: actual });
  const checkpoint = transaction
    .select()
    .from(recurrenceState)
    .where(eq(recurrenceState.taskId, options.task.id))
    .get();
  if (!checkpoint || checkpoint.currentGenerationId !== options.generation.id)
    throw domainError('INTERNAL_ERROR', 'Only the current generation can advance its checkpoint');
  const events: AuditEvent[] = [];
  let waiting = options.predecessor.id;
  if (options.active) {
    const successor = materializeOccurrence(transaction, {
      task: options.task,
      generation: options.generation,
      deadline,
      key: `after:${options.predecessor.id}`,
      now: options.now,
    });
    events.push(...successor.events);
    events.push(...expireOccurrence(transaction, { row: successor.row, now: options.now }).events);
    waiting = successor.row.id;
  }
  transaction
    .update(recurrenceState)
    .set({
      waitingPredecessorId: waiting,
      nextCandidateAt: options.active ? null : deadline,
      revision: checkpoint.revision + 1,
    })
    .where(eq(recurrenceState.taskId, options.task.id))
    .run();
  return { events };
}
