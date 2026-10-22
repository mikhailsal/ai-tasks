import { eq } from 'drizzle-orm';
import { projects, tasks } from '../../schema/entities.js';
import { projectLifecycleSchema } from '../../schema/projects.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { checkRevision } from '../database/guards.js';
import { executeMutation } from '../database/mutate.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { parseInput } from '../validation.js';
import { requireProject, readProjectConfiguration } from './read.js';
import { projectMutationResult } from './write.js';
import { applyRecurringProjectLifecycle } from './recurring-lifecycle.js';

function validateChildren(
  transaction: DatabaseTransaction,
  projectSlug: string,
  input: ReturnType<typeof projectLifecycleSchema.parse>,
): void {
  // Only child identities and revisions are needed; descriptions stay off this path.
  const children = transaction
    .select({
      id: tasks.id,
      revision: tasks.revision,
    })
    .from(tasks)
    .where(eq(tasks.projectSlug, projectSlug))
    .all();
  const expected = new Map(
    input.affected_tasks.map((task) => [task.task_id, task.expected_revision]),
  );
  if (expected.size !== input.affected_tasks.length)
    throw domainError('VALIDATION_ERROR', 'Affected task IDs must be distinct');
  const current = new Map(children.map((task) => [task.id, task]));
  const extra = input.affected_tasks.find((task) => !current.has(task.task_id));
  if (extra) {
    // One lookup classifies the first rejected target; valid batches never query per child.
    const target = transaction
      .select({ owner: tasks.projectSlug })
      .from(tasks)
      .where(eq(tasks.id, extra.task_id))
      .get();
    throw domainError(
      target ? 'PROJECT_MISMATCH' : 'TASK_NOT_FOUND',
      target ? 'An affected task belongs to another project' : 'An affected task does not exist',
      { entity_id: extra.task_id },
    );
  }
  if (children.length !== expected.size)
    throw domainError('VALIDATION_ERROR', 'Affected tasks must contain every child revision');
  for (const child of children) {
    checkRevision({
      expected: expected.get(child.id),
      current: child.revision,
      field: 'expected_revision',
      scope: 'task',
      entityId: child.id,
    });
  }
}

function changeProjectArchive(
  context: CoreContext,
  projectSlug: string,
  input: MutationEnvelope,
  archive: boolean,
) {
  const operation = archive ? 'project.archive' : 'project.restore';
  return executeMutation({
    context,
    projectSlug,
    input,
    operation,
    handler(transaction, now) {
      const before = requireProject(transaction, projectSlug);
      checkRevision({
        expected: input.expected_revision,
        current: before.revision,
        field: 'expected_revision',
        scope: 'project',
        entityId: before.id,
      });
      if ((before.archivedAt !== null) === archive)
        throw domainError(
          'VALIDATION_ERROR',
          archive ? 'Project is already archived' : 'Project is active',
        );
      const payload = parseInput(projectLifecycleSchema, input.payload);
      validateChildren(transaction, projectSlug, payload);
      const config = readProjectConfiguration(transaction, before);
      const childEvents = applyRecurringProjectLifecycle(transaction, {
        project: before,
        config,
        archive,
        now,
      });
      const after = transaction
        .update(projects)
        .set({
          archivedAt: archive ? now : null,
          revision: before.revision + 1,
          updatedAt: now,
        })
        .where(eq(projects.slug, projectSlug))
        .returning()
        .get();
      if (!after)
        throw domainError('INTERNAL_ERROR', 'Project lifecycle update returned no result');
      const result = projectMutationResult({ before, after, config, action: operation });
      return { data: result.data, events: [...childEvents, ...result.events] };
    },
  });
}

export function archiveProject(context: CoreContext, projectSlug: string, input: MutationEnvelope) {
  return changeProjectArchive(context, projectSlug, input, true);
}

export function restoreProject(context: CoreContext, projectSlug: string, input: MutationEnvelope) {
  return changeProjectArchive(context, projectSlug, input, false);
}
