import { eq } from 'drizzle-orm';
import { tasks, type projects } from '../../schema/entities.js';
import { taskDetailSchema, taskResourceSchema } from '../../schema/tasks.js';
import { slugSchema, uuidSchema } from '../../schema/values.js';
import { validatePriorityForModel, type ProjectConfigInput } from '../../schema/configuration.js';
import type { DatabaseConnection, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { formatTimestamp } from '../time.js';
import { renderMarkdown, RENDER_POLICY_VERSION } from '../markdown/render.js';
import { requireWorkflowStatus } from '../projects/workflows.js';
import { parseInput } from '../validation.js';
import { readTaskDependencies } from './dependencies-read.js';
import { readTaskRecurrence } from './recurrence-read.js';

export function requireTask(
  database: DatabaseConnection['db'] | DatabaseTransaction,
  projectSlug: string,
  taskId: string,
) {
  parseInput(slugSchema, projectSlug);
  parseInput(uuidSchema, taskId);
  const task = database.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw domainError('TASK_NOT_FOUND', 'The requested task does not exist');
  if (task.projectSlug !== projectSlug)
    throw domainError('PROJECT_MISMATCH', 'The target belongs to another project', {
      entity_id: taskId,
    });
  return task;
}

export function assertProjectActive(project: typeof projects.$inferSelect): void {
  if (project.archivedAt !== null)
    throw domainError('VALIDATION_ERROR', 'Archived projects are read-only');
}

export function taskStatus(task: typeof tasks.$inferSelect, config: ProjectConfigInput) {
  return requireWorkflowStatus(config, task.kind, task.statusId);
}

export function taskResource(
  task: typeof tasks.$inferSelect,
  project: typeof projects.$inferSelect,
  config: ProjectConfigInput,
  displayDeadline: number | null = task.deadline,
) {
  try {
    const status = taskStatus(task, config);
    return taskResourceSchema.parse({
      id: task.id,
      project_slug: task.projectSlug,
      kind: task.kind,
      title: task.title,
      description: task.description,
      emoji: task.emoji,
      status_id: task.statusId,
      category: status.category,
      priority: validatePriorityForModel(task.priority, config.priority_model),
      deadline: task.deadline === null ? null : formatTimestamp(task.deadline),
      display_deadline: displayDeadline === null ? null : formatTimestamp(displayDeadline),
      archived_at: task.archivedAt === null ? null : formatTimestamp(task.archivedAt),
      revision: task.revision,
      config_revision: project.configRevision,
      created_at: formatTimestamp(task.createdAt),
      updated_at: formatTimestamp(task.updatedAt),
    });
  } catch {
    throw domainError('INTERNAL_ERROR', 'The stored task resource is invalid');
  }
}

export function readTaskDetail(
  transaction: DatabaseTransaction,
  options: {
    task: typeof tasks.$inferSelect;
    project: typeof projects.$inferSelect;
    config: ProjectConfigInput;
    displayDeadline?: number | null;
  },
) {
  const dependencies = readTaskDependencies(transaction, options.task.id);
  const recurring =
    options.task.kind === 'recurring' ? readTaskRecurrence(transaction, options.task) : null;
  const displayDeadline =
    options.displayDeadline === undefined
      ? (recurring?.displayDeadline ?? options.task.deadline)
      : options.displayDeadline;
  return taskDetailSchema.parse({
    ...taskResource(options.task, options.project, options.config, displayDeadline),
    // A policy upgrade must never serve obsolete HTML while explicit maintenance
    // rebuilds the cache. Recomputing this response leaves the query side-effect free.
    rendered_html:
      options.task.renderPolicyVersion === RENDER_POLICY_VERSION
        ? options.task.descriptionHtml
        : renderMarkdown(options.task.description),
    dependencies,
    blocked: dependencies.some((link) => !link.satisfied),
    recurrence: recurring?.configuration ?? null,
  });
}
