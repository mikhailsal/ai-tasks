import { and, eq } from 'drizzle-orm';
import { ordinaryWorkflowSchema } from '../../schema/configuration.js';
import { taskDependencies } from '../../schema/dependencies.js';
import { projectConfigs, projects, tasks } from '../../schema/entities.js';
import { dependencyResourceSchema } from '../../schema/tasks.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';

export function readTaskDependencies(transaction: DatabaseTransaction, taskId: string) {
  const rows = transaction
    .select({
      prerequisiteId: tasks.id,
      projectSlug: tasks.projectSlug,
      statusId: tasks.statusId,
      workflow: projectConfigs.ordinaryWorkflow,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.prerequisiteTaskId))
    .innerJoin(projects, eq(projects.slug, tasks.projectSlug))
    .leftJoin(
      projectConfigs,
      and(
        eq(projectConfigs.projectSlug, projects.slug),
        eq(projectConfigs.revision, projects.configRevision),
      ),
    )
    .where(eq(taskDependencies.dependentTaskId, taskId))
    .orderBy(tasks.projectSlug, tasks.id)
    .limit(101)
    .all();
  if (rows.length > 100)
    throw domainError('INTERNAL_ERROR', 'Stored task prerequisites exceed the supported limit');
  return rows.map((row) => {
    const workflow = ordinaryWorkflowSchema.safeParse(row.workflow);
    const status = workflow.success
      ? workflow.data.statuses.find((value) => value.id === row.statusId)
      : undefined;
    if (!status) throw domainError('INTERNAL_ERROR', 'A prerequisite configuration is invalid');
    // Archived completed prerequisites still satisfy; neither archive nor cancellation
    // invents completion. Labels never participate in the guard.
    return dependencyResourceSchema.parse({
      task_id: taskId,
      prerequisite_task_id: row.prerequisiteId,
      prerequisite_project_slug: row.projectSlug,
      satisfied: status.category === 'completed',
    });
  });
}

export function assertPrerequisitesSatisfied(
  transaction: DatabaseTransaction,
  taskId: string,
  targetCategory: string,
): void {
  if (!['in_progress', 'review', 'completed'].includes(targetCategory)) return;
  const blocked = readTaskDependencies(transaction, taskId).filter((link) => !link.satisfied);
  if (blocked.length > 0)
    throw domainError('DEPENDENCY_BLOCKED', 'Complete the task prerequisites before advancing', {
      task_id: taskId,
      prerequisites: blocked.map((link) => ({
        project_slug: link.prerequisite_project_slug,
        task_id: link.prerequisite_task_id,
      })),
    });
}
