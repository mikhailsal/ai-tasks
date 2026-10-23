import { syncBoardMembership } from '../tasks/board-order.js';
import { and, eq, isNull } from 'drizzle-orm';
import type { ProjectConfigInput } from '../../schema/configuration.js';
import { tasks, type projects } from '../../schema/entities.js';
import { recurrenceIntervals, recurrenceState } from '../../schema/recurrence.js';
import { jsonValueSchema } from '../../schema/values.js';
import type { AuditEvent } from '../audit/append.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { assertRetirable } from '../recurrence/retirement.js';
import { setRecurrenceBehavior } from '../recurrence/generations.js';
import { taskResource, taskStatus } from '../tasks/read.js';

type ProjectLifecycle = {
  project: typeof projects.$inferSelect;
  config: ProjectConfigInput;
  archive: boolean;
  now: number;
};

function restoredChildEvent(
  before: typeof tasks.$inferSelect,
  after: typeof tasks.$inferSelect,
  options: ProjectLifecycle,
): AuditEvent {
  const previous = taskResource(before, options.project, options.config);
  const current = taskResource(after, options.project, options.config);
  return {
    entity_type: 'task',
    entity_id: before.id,
    action: 'project.restore',
    changes: Object.entries(current)
      .filter(
        ([field, value]) => JSON.stringify(Reflect.get(previous, field)) !== JSON.stringify(value),
      )
      .map(([field, value]) => ({
        field,
        before: jsonValueSchema.parse(Reflect.get(previous, field)),
        after: jsonValueSchema.parse(value),
      })),
    config_snapshot: jsonValueSchema.parse({
      revision: options.project.configRevision,
      ...options.config,
    }),
  };
}

/** Ordinary descriptions never enter this path; recurring audit rows are fetched together. */
export function applyRecurringProjectLifecycle(
  transaction: DatabaseTransaction,
  options: ProjectLifecycle,
): AuditEvent[] {
  const children = transaction
    .select({ task: tasks, state: recurrenceState })
    .from(tasks)
    .leftJoin(
      recurrenceState,
      and(eq(recurrenceState.taskId, tasks.id), eq(recurrenceState.projectSlug, tasks.projectSlug)),
    )
    .where(and(eq(tasks.projectSlug, options.project.slug), eq(tasks.kind, 'recurring')))
    .all();
  if (options.archive) {
    // These checks are pure: callers must explicitly tick owed work before retiring it.
    // Validate every child before closing even the first active interval.
    for (const child of children)
      assertRetirable(transaction, { task: child.task, now: options.now });
    transaction
      .update(recurrenceIntervals)
      .set({ endAt: options.now })
      .where(
        and(
          eq(recurrenceIntervals.projectSlug, options.project.slug),
          eq(recurrenceIntervals.behavior, 'active'),
          isNull(recurrenceIntervals.endAt),
        ),
      )
      .run();
    return [];
  }
  const restoreStatus = options.config.recurring_workflow.statuses.find(
    (status) => status.id === options.config.recurring_workflow.restore_status_id,
  );
  if (!restoreStatus || restoreStatus.category !== 'paused')
    throw domainError('INTERNAL_ERROR', 'The configured recurring restore status must be paused');
  const active = children.filter(
    ({ task }) =>
      task.archivedAt === null && taskStatus(task, options.config).category === 'active',
  );
  for (const child of active) {
    if (!child.state)
      throw domainError('INTERNAL_ERROR', 'A recurring child checkpoint is missing');
  }
  const events: AuditEvent[] = [];
  for (const child of active) {
    const generationId = child.state?.currentGenerationId;
    if (!generationId)
      throw domainError('INTERNAL_ERROR', 'A recurring child checkpoint is missing');
    // Project restoration is an administrative pause, independent of user edges/consent.
    setRecurrenceBehavior(transaction, {
      task: child.task,
      generationId,
      behavior: 'paused',
      now: options.now,
    });
    const after = transaction
      .update(tasks)
      .set({
        statusId: restoreStatus.id,
        revision: child.task.revision + 1,
        updatedAt: options.now,
      })
      .where(eq(tasks.id, child.task.id))
      .returning()
      .get();
    if (!after)
      throw domainError('INTERNAL_ERROR', 'Recurring child restoration returned no result');
    const event = restoredChildEvent(child.task, after, options);
    const boardChange = syncBoardMembership(transaction, { before: child.task, after });
    if (boardChange) event.changes.push(boardChange);
    events.push(event);
  }
  return events;
}
