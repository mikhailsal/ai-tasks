import { and, eq, inArray, min } from 'drizzle-orm';
import type { tasks } from '../../schema/entities.js';
import { occurrences, recurrenceState, scheduleGenerations } from '../../schema/recurrence.js';
import { scheduleSchema } from '../../schema/recurrence-input.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { formatTimestamp } from '../time.js';

/** Pure schema-level queries avoid a dependency cycle through recurrence commands. */
export function readTaskRecurrence(
  transaction: DatabaseTransaction,
  task: typeof tasks.$inferSelect,
) {
  const current = transaction
    .select({ generation: scheduleGenerations })
    .from(recurrenceState)
    .innerJoin(scheduleGenerations, eq(scheduleGenerations.id, recurrenceState.currentGenerationId))
    .where(
      and(eq(recurrenceState.taskId, task.id), eq(recurrenceState.projectSlug, task.projectSlug)),
    )
    .get();
  const generation = current?.generation;
  if (!generation || generation.taskId !== task.id || generation.projectSlug !== task.projectSlug)
    throw domainError('INTERNAL_ERROR', 'The recurring task configuration is missing');
  const schedule = scheduleSchema.safeParse(generation.schedule);
  if (!schedule.success || schedule.data.mode !== generation.mode)
    throw domainError('INTERNAL_ERROR', 'The recurring task configuration is invalid');
  const displayDeadline =
    transaction
      .select({ deadline: min(occurrences.deadline) })
      .from(occurrences)
      .where(and(eq(occurrences.taskId, task.id), inArray(occurrences.state, ['pending', 'debt'])))
      .get()?.deadline ?? null;
  return {
    displayDeadline,
    configuration: {
      generation_id: generation.id,
      generation_number: generation.generationNumber,
      first_deadline: formatTimestamp(generation.firstDeadline),
      schedule: schedule.data,
      timezone: generation.timezone,
      miss_policy: generation.missPolicy,
      confirmation_window_ms: generation.windowMs,
    },
  };
}
