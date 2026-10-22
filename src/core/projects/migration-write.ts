import { eq, inArray } from 'drizzle-orm';
import { projectConfigs, projects, taskEmojiReservations, tasks } from '../../schema/entities.js';
import { jsonValueSchema, type JsonValue } from '../../schema/values.js';
import type { AuditEvent } from '../audit/append.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { syncTaskEmoji } from '../tasks/emoji.js';
import { taskResource } from '../tasks/read.js';
import type { MigrationPlan, ProjectedTask } from './migration-types.js';
import { applyRecurringMigration } from './migration-recurrence.js';
import { completionRecordedAt } from '../tasks/completion-time.js';

function semanticSnapshot(plan: MigrationPlan) {
  return jsonValueSchema.parse({
    revision: plan.project.configRevision + 1,
    ...plan.input.config,
    previous: { revision: plan.project.configRevision, ...plan.previous },
  });
}

function writeConfiguration(
  transaction: DatabaseTransaction,
  plan: MigrationPlan,
  options: { now: number; actor: CoreContext['actor'] },
) {
  const config = plan.input.config;
  transaction
    .insert(projectConfigs)
    .values({
      projectSlug: plan.project.slug,
      revision: plan.project.configRevision + 1,
      priorityModel: jsonValueSchema.parse(config.priority_model),
      ordinaryWorkflow: jsonValueSchema.parse(config.ordinary_workflow),
      recurringWorkflow: jsonValueSchema.parse(config.recurring_workflow),
      semanticSnapshot: jsonValueSchema.parse(config),
      effectiveAt: options.now,
      actor: options.actor,
    })
    .run();
  const updated = transaction
    .update(projects)
    .set({
      configRevision: plan.project.configRevision + 1,
      revision: plan.project.revision + 1,
      updatedAt: options.now,
    })
    .where(eq(projects.id, plan.project.id))
    .returning()
    .get();
  if (!updated) throw domainError('INTERNAL_ERROR', 'Configuration update returned no project');
  return updated;
}

function configurationEvent(plan: MigrationPlan): AuditEvent {
  return {
    entity_type: 'project',
    entity_id: plan.project.id,
    action: 'config.migrate',
    changes: [
      {
        field: 'configuration',
        before: jsonValueSchema.parse({ revision: plan.project.configRevision, ...plan.previous }),
        after: jsonValueSchema.parse({
          revision: plan.project.configRevision + 1,
          ...plan.input.config,
        }),
      },
      {
        field: 'config_revision',
        before: plan.project.configRevision,
        after: plan.project.configRevision + 1,
      },
      { field: 'revision', before: plan.project.revision, after: plan.project.revision + 1 },
    ],
    config_snapshot: semanticSnapshot(plan),
  };
}

function taskEvent(
  plan: MigrationPlan,
  task: ProjectedTask,
  options: { project: typeof projects.$inferSelect; after: typeof tasks.$inferSelect },
): AuditEvent {
  const before = taskResource(task.before, plan.project, plan.previous);
  const after = taskResource(options.after, options.project, plan.input.config);
  return {
    entity_type: 'task',
    entity_id: task.before.id,
    action: 'config.migrate',
    changes: Object.entries(after)
      .filter(
        ([field, value]) => JSON.stringify(Reflect.get(before, field)) !== JSON.stringify(value),
      )
      .map(([field, value]) => ({
        field,
        before: jsonValueSchema.parse(Reflect.get(before, field)),
        after: jsonValueSchema.parse(value),
      })),
    config_snapshot: semanticSnapshot(plan),
  };
}

function writeTask(transaction: DatabaseTransaction, task: ProjectedTask, now: number) {
  const after = transaction
    .update(tasks)
    .set({
      statusId: task.after.statusId,
      completionRecordedAt: completionRecordedAt(task.before, task.oldCategory, task.category, now),
      archivedAt: task.after.archivedAt,
      priority: task.after.priority,
      priorityScaled: task.after.priorityScaled,
      revision: task.before.revision + 1,
      updatedAt: now,
    })
    .where(eq(tasks.id, task.before.id))
    .returning()
    .get();
  if (!after) throw domainError('INTERNAL_ERROR', 'Migration update returned no task');
  syncTaskEmoji(transaction, {
    projectSlug: after.projectSlug,
    taskId: after.id,
    emoji: after.emoji,
    reserve:
      after.archivedAt === null && !['completed', 'cancelled', 'archived'].includes(task.category),
    collision: 'reject',
  });
  return after;
}

export function applyMigration(
  transaction: DatabaseTransaction,
  plan: MigrationPlan,
  options: { now: number; actor: CoreContext['actor'] },
): { data: JsonValue; events: AuditEvent[] } {
  const changed = plan.tasks.filter((task) => task.changed);
  const ids = changed.map((task) => task.before.id);
  // Release every old claim before acquiring the projected set, in one transaction.
  for (let offset = 0; offset < ids.length; offset += 500)
    transaction
      .delete(taskEmojiReservations)
      .where(inArray(taskEmojiReservations.taskId, ids.slice(offset, offset + 500)))
      .run();
  const project = writeConfiguration(transaction, plan, options);
  const events = [configurationEvent(plan)];
  const affected = changed.map((task) => {
    events.push(...applyRecurringMigration(transaction, task, options.now));
    const after = writeTask(transaction, task, options.now);
    events.push(taskEvent(plan, task, { project, after }));
    return { task_id: after.id, revision: after.revision };
  });
  return {
    data: jsonValueSchema.parse({
      config: { revision: project.configRevision, ...plan.input.config },
      affected_tasks: affected,
    }),
    events,
  };
}
