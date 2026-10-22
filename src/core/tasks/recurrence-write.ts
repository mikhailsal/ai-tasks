import type { z } from 'zod/mini';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { taskDetailSchema, type taskTransitionSchema } from '../../schema/tasks.js';
import { taskMutationResult } from './write.js';
import type { DatabaseTransaction } from '../database/types.js';
import { checkRevision } from '../database/guards.js';
import { domainError } from '../errors.js';
import { applyRecurrenceTransition } from '../recurrence/control.js';
import { recurrenceSettings } from '../recurrence/generations.js';
import type { ProjectConfigInput } from '../../schema/configuration.js';
/** Conditional guards run inside the mutation handler, after epoch and receipt replay. */
export function assertRecurrenceSettings(
  transaction: DatabaseTransaction,
  input: MutationEnvelope,
) {
  checkRevision({
    expected: input.expected_settings_revision,
    current: recurrenceSettings(transaction).revision,
    field: 'expected_settings_revision',
    scope: 'settings',
  });
}
export function recurringArchiveTarget(config: ProjectConfigInput, source: string) {
  const targets = config.recurring_workflow.statuses.filter(
    (status) =>
      status.category === 'archived' &&
      config.recurring_workflow.transitions.some(
        (edge) => edge.from === source && edge.to === status.id,
      ),
  );
  if (targets.length !== 1 || !targets[0])
    throw domainError(
      'VALIDATION_ERROR',
      'Choose an explicit configured recurrence control to archive this task',
    );
  return targets[0].id;
}
export function moveRecurringTask(
  transaction: DatabaseTransaction,
  options: Omit<Parameters<typeof applyRecurrenceTransition>[1], 'payload' | 'marker'> & {
    input: MutationEnvelope;
    data: z.infer<typeof taskTransitionSchema>;
  },
) {
  assertRecurrenceSettings(transaction, options.input);
  const { data } = options;
  return applyRecurrenceTransition(transaction, {
    ...options,
    payload: {
      to_status_id: data.to_status_id,
      ...(data.confirmation === undefined ? {} : { confirmation: data.confirmation }),
    },
    marker: {
      ...(data.replacement_emoji === undefined
        ? {}
        : { replacement_emoji: data.replacement_emoji }),
      ...(data.emoji_collision === undefined ? {} : { emoji_collision: data.emoji_collision }),
    },
  });
}
/** A new draft has no occurrence event, so its creation audit must capture its rule. */
export function createdTaskMutationResult(
  transaction: DatabaseTransaction,
  options: Parameters<typeof taskMutationResult>[1],
) {
  const result = taskMutationResult(transaction, options);
  const detail = taskDetailSchema.parse(result.data);
  if (detail.kind === 'ordinary') return result;
  if (detail.recurrence === null)
    throw domainError('INTERNAL_ERROR', 'A recurring task requires captured configuration');
  return {
    ...result,
    events: result.events.map((event) => ({
      ...event,
      changes: [...event.changes, { field: 'recurrence', before: null, after: detail.recurrence }],
    })),
  };
}
