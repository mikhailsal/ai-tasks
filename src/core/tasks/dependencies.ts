import { and, eq } from 'drizzle-orm';
import { z } from 'zod/mini';
import { taskDependencies } from '../../schema/dependencies.js';
import { tasks } from '../../schema/entities.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { jsonValueSchema, slugSchema, uuidSchema } from '../../schema/values.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { executeMutation } from '../database/mutate.js';
import { domainError } from '../errors.js';
import { requireProject, readProjectConfiguration } from '../projects/read.js';
import { parseInput } from '../validation.js';
import { validateDependencyGraph } from './dependency-graph.js';
import { readTaskDependencies } from './dependencies-read.js';
import { assertProjectActive, requireTask, taskStatus } from './read.js';
import { taskMutationResult } from './write.js';
export { validateDependencyGraph } from './dependency-graph.js';
export const dependencyMutationSchema = z.strictObject({
  prerequisite_task_id: uuidSchema,
  prerequisite_project_slug: slugSchema,
});
function ordinaryEndpoint(transaction: DatabaseTransaction, slug: string, id: string) {
  const task = requireTask(transaction, slug, id);
  if (task.kind !== 'ordinary')
    throw domainError('VALIDATION_ERROR', 'Dependencies require ordinary task endpoints');
  return task;
}
function writeLink(
  transaction: DatabaseTransaction,
  options: {
    add: boolean;
    taskId: string;
    projectSlug: string;
    target: z.output<typeof dependencyMutationSchema>;
    now: number;
    operationId: string;
  },
) {
  const { taskId, projectSlug, target } = options;
  if (options.add) {
    transaction
      .insert(taskDependencies)
      .values({
        dependentTaskId: taskId,
        dependentProjectSlug: projectSlug,
        prerequisiteTaskId: target.prerequisite_task_id,
        prerequisiteProjectSlug: target.prerequisite_project_slug,
        createdAt: options.now,
        createdOperationId: options.operationId,
      })
      .run();
  } else {
    transaction
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.dependentTaskId, taskId),
          eq(taskDependencies.prerequisiteTaskId, target.prerequisite_task_id),
        ),
      )
      .run();
  }
  validateDependencyGraph(transaction);
}
function changeDependency(
  context: CoreContext,
  projectSlug: string,
  taskId: string,
  options: {
    input: MutationEnvelope;
    add: boolean;
  },
) {
  const { input, add } = options;
  const operation = add ? 'dependency.add' : 'dependency.remove';
  return executeMutation({
    context,
    projectSlug,
    input,
    operation,
    guards: { entity: { type: 'task', id: taskId } },
    handler(transaction, now) {
      const project = requireProject(transaction, projectSlug);
      assertProjectActive(project);
      const before = ordinaryEndpoint(transaction, projectSlug, taskId);
      if (before.archivedAt !== null)
        throw domainError('VALIDATION_ERROR', 'Archived tasks are read-only');
      const config = readProjectConfiguration(transaction, project);
      const target = parseInput(dependencyMutationSchema, input.payload);
      ordinaryEndpoint(transaction, target.prerequisite_project_slug, target.prerequisite_task_id);
      if (taskId === target.prerequisite_task_id)
        throw domainError('VALIDATION_ERROR', 'A task cannot depend on itself');
      const previousLinks = readTaskDependencies(transaction, taskId);
      const exists = previousLinks.some(
        (link) => link.prerequisite_task_id === target.prerequisite_task_id,
      );
      if (add === exists)
        throw domainError(
          'VALIDATION_ERROR',
          add ? 'The prerequisite already exists' : 'The prerequisite does not exist',
        );
      writeLink(transaction, {
        add,
        taskId,
        projectSlug,
        target,
        now,
        operationId: input.operation_id,
      });
      const links = readTaskDependencies(transaction, taskId);
      const status = taskStatus(before, config);
      const added = links.find((link) => link.prerequisite_task_id === target.prerequisite_task_id);
      if (
        add &&
        ['in_progress', 'review', 'completed'].includes(status.category) &&
        !added?.satisfied
      )
        throw domainError(
          'DEPENDENCY_BLOCKED',
          'An advanced task requires completed new prerequisites',
        );
      const after = transaction
        .update(tasks)
        .set({ revision: before.revision + 1, updatedAt: now })
        .where(eq(tasks.id, taskId))
        .returning()
        .get();
      if (!after) throw domainError('INTERNAL_ERROR', 'Dependency update did not return its task');
      const result = taskMutationResult(transaction, {
        before,
        after,
        project,
        config,
        action: operation,
      });
      for (const event of result.events)
        event.changes.push({
          field: 'dependencies',
          before: jsonValueSchema.parse(previousLinks),
          after: jsonValueSchema.parse(links),
        });
      return result;
    },
  });
}
export function addDependency(
  context: CoreContext,
  projectSlug: string,
  taskId: string,
  input: MutationEnvelope,
) {
  return changeDependency(context, projectSlug, taskId, { input, add: true });
}
export function removeDependency(
  context: CoreContext,
  projectSlug: string,
  taskId: string,
  input: MutationEnvelope,
) {
  return changeDependency(context, projectSlug, taskId, { input, add: false });
}
