import { and, eq, max } from 'drizzle-orm';
import { completeOccurrencesSchema } from '../../schema/recurrence-input.js';
import { occurrences } from '../../schema/recurrence.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { jsonValueSchema } from '../../schema/values.js';
import type { AuditEvent } from '../audit/append.js';
import { executeMutation } from '../database/mutate.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { parseTimestamp } from '../time.js';
import { parseInput } from '../validation.js';
import { expireOccurrence } from './expire.js';
import { readGeneration, currentRecurrence } from './generations.js';
import {
  occurrenceCommandContext,
  selectOccurrences,
  finishOccurrenceCommand,
} from './outcomes.js';
import { occurrenceEvent, type OccurrenceRow } from './snapshots.js';
import { createCompletionSuccessor } from './successors.js';

function completionPlan(
  transaction: DatabaseTransaction,
  options: {
    rows: OccurrenceRow[];
    actuals: Map<string, number>;
  },
) {
  const maxima = new Map<string, number | null>();
  return options.rows.map((row) => {
    if (!['pending', 'debt', 'missed'].includes(row.state))
      throw domainError(
        'VALIDATION_ERROR',
        'Only pending, debt or missed occurrences can complete',
      );
    const actual = options.actuals.get(row.id);
    if (actual === undefined)
      throw domainError('INTERNAL_ERROR', 'A selected completion time is missing');
    const { generation, schedule } = readGeneration(transaction, row.generationId);
    if (schedule.mode === 'after_completion') {
      if (!maxima.has(generation.id)) {
        const maximum =
          transaction
            .select({ actual: max(occurrences.actualCompletedAt) })
            .from(occurrences)
            .where(eq(occurrences.generationId, generation.id))
            .get()?.actual ?? null;
        maxima.set(generation.id, maximum);
      }
      const previous = maxima.get(generation.id);
      if (previous !== null && previous !== undefined && actual < previous)
        throw domainError(
          'VALIDATION_ERROR',
          'Actual completion times must be nondecreasing within an elapsed generation',
        );
      // Caller selection order is the explicit recording order; do not silently reorder it.
      maxima.set(generation.id, actual);
    }
    return { row, actual, generation, schedule };
  });
}

function completeSelected(
  transaction: DatabaseTransaction,
  options: {
    row: OccurrenceRow;
    actual: number;
    now: number;
  },
) {
  const expiry = expireOccurrence(transaction, { row: options.row, now: options.now });
  const before = expiry.row;
  const row = transaction
    .update(occurrences)
    .set({
      state: before.state === 'pending' ? 'completed' : 'completed_late',
      actualCompletedAt: options.actual,
      completionRecordedAt: options.now,
      revision: before.revision + 1,
    })
    .where(and(eq(occurrences.id, before.id), eq(occurrences.revision, before.revision)))
    .returning()
    .get();
  if (!row) throw domainError('INTERNAL_ERROR', 'Occurrence completion returned no result');
  return { row, events: [...expiry.events, occurrenceEvent(before, row, 'occurrence.complete')] };
}

export function completeOccurrences(
  context: CoreContext,
  projectSlug: string,
  taskId: string,
  input: MutationEnvelope,
) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'occurrence.complete',
    input,
    guards: { entity: { type: 'task', id: taskId }, settings: true },
    handler(transaction, now) {
      const command = occurrenceCommandContext(transaction, projectSlug, taskId);
      const payload = parseInput(completeOccurrencesSchema, input.payload);
      const rows = selectOccurrences(transaction, {
        task: command.task,
        selected: payload.occurrences,
      });
      const actuals = new Map(
        payload.occurrences.map((selected) => {
          const actual =
            selected.actual_completed_at === undefined
              ? now
              : parseTimestamp(selected.actual_completed_at);
          if (actual > now)
            throw domainError('VALIDATION_ERROR', 'Actual completion cannot be in the future');
          return [selected.id, actual];
        }),
      );
      const plans = completionPlan(transaction, { rows, actuals });
      const current = currentRecurrence(transaction, command.task);
      const events: AuditEvent[] = [];
      const completed: OccurrenceRow[] = [];
      for (const plan of plans) {
        const result = completeSelected(transaction, { row: plan.row, actual: plan.actual, now });
        completed.push(result.row);
        events.push(...result.events);
        if (
          plan.generation.id === current.generation.id &&
          plan.schedule.mode === 'after_completion'
        ) {
          events.push(
            ...createCompletionSuccessor(transaction, {
              task: command.task,
              generation: plan.generation,
              schedule: plan.schedule,
              predecessor: result.row,
              now,
              active: command.status.category === 'active',
            }).events,
          );
        }
      }
      const snapshot = jsonValueSchema.parse({
        revision: command.project.configRevision,
        ...command.config,
      });
      return finishOccurrenceCommand(transaction, {
        context: command,
        rows: completed,
        events: events.map((event) => ({
          ...event,
          config_snapshot: event.config_snapshot ?? snapshot,
        })),
        now,
        action: 'occurrence.complete',
        advanceParent: plans.some((plan) => plan.generation.id === current.generation.id),
      });
    },
  });
}
