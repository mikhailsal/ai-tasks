import type { z } from 'zod/mini';
import { and, eq, inArray } from 'drizzle-orm';
import { ordinaryWorkflowSchema } from '../../schema/configuration.js';
import { taskDependencies } from '../../schema/dependencies.js';
import { projectConfigs, projects, tasks } from '../../schema/entities.js';
import { dependencyResourceSchema } from '../../schema/tasks.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';

function storedPrerequisiteWorkflow(value: unknown) {
  const workflow = ordinaryWorkflowSchema.safeParse(value);
  if (!workflow.success)
    throw domainError('INTERNAL_ERROR', 'A prerequisite configuration is invalid');
  return workflow.data;
}
function prerequisiteCompleted(
  workflow: z.output<typeof ordinaryWorkflowSchema>,
  statusId: string,
) {
  const status = workflow.statuses.find((value) => value.id === statusId);
  if (!status) throw domainError('INTERNAL_ERROR', 'A prerequisite configuration is invalid');
  return status.category === 'completed';
}
/** Two bounded reads for a page: lightweight edges, then each project workflow once. */
export function readBlockedTaskIds(transaction: DatabaseTransaction, taskIds: string[]) {
  const blocked = new Set<string>();
  if (taskIds.length === 0) return blocked;
  const rows = transaction
    .select({
      dependentId: taskDependencies.dependentTaskId,
      projectSlug: tasks.projectSlug,
      statusId: tasks.statusId,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.prerequisiteTaskId))
    .where(inArray(taskDependencies.dependentTaskId, taskIds))
    .limit(taskIds.length * 100 + 1)
    .all();
  const counts = new Map<string, number>();
  const configurations = transaction
    .select({ projectSlug: projects.slug, workflow: projectConfigs.ordinaryWorkflow })
    .from(projects)
    .leftJoin(
      projectConfigs,
      and(
        eq(projectConfigs.projectSlug, projects.slug),
        eq(projectConfigs.revision, projects.configRevision),
      ),
    )
    .where(inArray(projects.slug, [...new Set(rows.map((row) => row.projectSlug))]))
    .all();
  const workflows = new Map(
    configurations.map((row) => [row.projectSlug, storedPrerequisiteWorkflow(row.workflow)]),
  );
  for (const row of rows) {
    const count = (counts.get(row.dependentId) ?? 0) + 1;
    counts.set(row.dependentId, count);
    if (count > 100)
      throw domainError('INTERNAL_ERROR', 'Stored task prerequisites exceed the supported limit');
    const workflow = workflows.get(row.projectSlug);
    if (!workflow) throw domainError('INTERNAL_ERROR', 'A prerequisite configuration is invalid');
    if (!prerequisiteCompleted(workflow, row.statusId)) blocked.add(row.dependentId);
  }
  return blocked;
}

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
    const workflow = storedPrerequisiteWorkflow(row.workflow);
    // Archived completed prerequisites still satisfy; neither archive nor cancellation
    // invents completion. Labels never participate in the guard.
    return dependencyResourceSchema.parse({
      task_id: taskId,
      prerequisite_task_id: row.prerequisiteId,
      prerequisite_project_slug: row.projectSlug,
      satisfied: prerequisiteCompleted(workflow, row.statusId),
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
