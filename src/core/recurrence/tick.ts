import { eq } from 'drizzle-orm';
import { tasks } from '../../schema/entities.js';
import { tickRecurrenceSchema } from '../../schema/recurrence-input.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { jsonValueSchema } from '../../schema/values.js';
import type { AuditEvent } from '../audit/append.js';
import { checkRevision } from '../database/guards.js';
import { executeMutation } from '../database/mutate.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { readProjectConfiguration, requireProject } from '../projects/read.js';
import { assertProjectActive } from '../tasks/read.js';
import { parseInput } from '../validation.js';
import { advanceCalendar } from './calendar-enumeration.js';
import { expireTaskOccurrences } from './expire.js';
import { requireRecurring, type RecurringTask } from './generations.js';

/** Reusable transactional processing; callers retain their own guards and audit context. */
export function processRecurrenceTask(
  transaction: DatabaseTransaction,
  options: { task: RecurringTask; now: number; limit?: number },
) {
  const limit = options.limit ?? 128;
  const expiry = expireTaskOccurrences(transaction, {
    taskId: options.task.id,
    now: options.now,
    limit,
  });
  const remaining = limit - expiry.processed;
  const calendar =
    remaining > 0
      ? advanceCalendar(transaction, { ...options, limit: remaining })
      : { events: [], processed: 0, hasMore: true };
  return {
    events: [...expiry.events, ...calendar.events],
    processed: expiry.processed + calendar.processed,
    hasMore: expiry.hasMore || calendar.hasMore,
  };
}

function tickParent(
  transaction: DatabaseTransaction,
  options: { task: RecurringTask; now: number; limit: number },
) {
  const result = processRecurrenceTask(transaction, options);
  transaction
    .update(tasks)
    .set({ revision: options.task.revision + 1, updatedAt: options.now })
    .where(eq(tasks.id, options.task.id))
    .run();
  const event: AuditEvent = {
    entity_type: 'task',
    entity_id: options.task.id,
    action: 'recurrence.tick',
    changes: [
      { field: 'revision', before: options.task.revision, after: options.task.revision + 1 },
    ],
  };
  return { ...result, events: [...result.events, event] };
}

export function tickRecurrence(context: CoreContext, projectSlug: string, input: MutationEnvelope) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'recurrence.tick',
    input,
    guards: { settings: true },
    handler(transaction, now) {
      const project = requireProject(transaction, projectSlug);
      assertProjectActive(project);
      const config = readProjectConfiguration(transaction, project);
      const data = parseInput(tickRecurrenceSchema, input.payload);
      // Resolve the complete selection before any expiry/checkpoint/state write.
      const parents = data.tasks.map((selected) => {
        const task = requireRecurring(transaction, projectSlug, selected.task_id);
        if (task.archivedAt !== null)
          throw domainError('VALIDATION_ERROR', 'Archived tasks are read-only');
        checkRevision({
          expected: selected.expected_revision,
          current: task.revision,
          field: 'expected_revision',
          scope: 'task',
          entityId: task.id,
        });
        return task;
      });
      const events: AuditEvent[] = [];
      const processedIds: string[] = [];
      let remaining = 128;
      let hasMore = parents.length > 128;
      for (const task of parents.slice(0, 128)) {
        if (remaining === 0) {
          hasMore = true;
          break;
        }
        const result = tickParent(transaction, { task, now, limit: remaining });
        events.push(...result.events);
        remaining -= result.processed;
        hasMore ||= result.hasMore;
        processedIds.push(task.id);
      }
      const snapshot = jsonValueSchema.parse({ revision: project.configRevision, ...config });
      return {
        data: {
          task_ids: processedIds,
          processed: 128 - remaining,
          has_more: hasMore,
          generated_ids: events
            .filter((event) => event.action === 'occurrence.create')
            .map((event) => event.entity_id),
          expired_ids: events
            .filter((event) => event.action === 'occurrence.miss')
            .map((event) => event.entity_id),
          affected_tasks: parents
            .filter((task) => processedIds.includes(task.id))
            .map((task) => ({ task_id: task.id, revision: task.revision + 1 })),
        },
        events: events.map((event) => ({
          ...event,
          config_snapshot: event.config_snapshot ?? snapshot,
        })),
      };
    },
  });
}
