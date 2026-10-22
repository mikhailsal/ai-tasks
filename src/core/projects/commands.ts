import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { projects, projectConfigs } from '../../schema/entities.js';
import { projectCreateSchema, projectPatchSchema } from '../../schema/projects.js';
import { jsonValueSchema } from '../../schema/values.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { executeMutation } from '../database/mutate.js';
import { checkRevision } from '../database/guards.js';
import type { CoreContext } from '../database/types.js';
import { domainError } from '../errors.js';
import { parseInput } from '../validation.js';
import { reserveProjectEmoji } from '../tasks/emoji.js';
import { createDefaultProjectConfig } from './presets.js';
import { requireProject, readProjectConfiguration } from './read.js';
import { projectMutationResult } from './write.js';
export { archiveProject, restoreProject } from './lifecycle.js';

export function createProject(context: CoreContext, projectSlug: string, input: MutationEnvelope) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'project.create',
    input,
    guards: { projectRequired: false, config: false },
    handler(transaction, now) {
      const data = parseInput(projectCreateSchema, input.payload);
      if (data.slug !== projectSlug)
        throw domainError('VALIDATION_ERROR', 'Project slug must match the explicit scope');
      if (
        transaction
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.slug, projectSlug))
          .get()
      )
        throw domainError('VALIDATION_ERROR', 'Project slug is already in use');
      const config = data.config ?? createDefaultProjectConfig();
      const marker = reserveProjectEmoji(transaction, { projectSlug, emoji: data.emoji, now });
      const created = transaction
        .insert(projects)
        .values({
          id: randomUUID(),
          slug: projectSlug,
          name: data.name,
          description: data.description ?? '',
          emoji: marker.emoji,
          emojiKey: marker.key,
          priority: data.priority ?? 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      transaction
        .insert(projectConfigs)
        .values({
          projectSlug,
          revision: 1,
          priorityModel: jsonValueSchema.parse(config.priority_model),
          ordinaryWorkflow: jsonValueSchema.parse(config.ordinary_workflow),
          recurringWorkflow: jsonValueSchema.parse(config.recurring_workflow),
          semanticSnapshot: jsonValueSchema.parse(config),
          effectiveAt: now,
          actor: context.actor,
        })
        .run();
      return projectMutationResult({
        before: null,
        after: created,
        config,
        action: 'project.create',
      });
    },
  });
}

export function updateProject(context: CoreContext, projectSlug: string, input: MutationEnvelope) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'project.update',
    input,
    handler(transaction, now) {
      const before = requireProject(transaction, projectSlug);
      checkRevision({
        expected: input.expected_revision,
        current: before.revision,
        field: 'expected_revision',
        scope: 'project',
        entityId: before.id,
      });
      if (before.archivedAt !== null)
        throw domainError('VALIDATION_ERROR', 'Archived projects are read-only');
      const patch = parseInput(projectPatchSchema, input.payload);
      const config = readProjectConfiguration(transaction, before);
      const marker = reserveProjectEmoji(transaction, {
        projectSlug,
        emoji: patch.emoji ?? before.emoji,
        now,
      });
      const after = transaction
        .update(projects)
        .set({
          name: patch.name ?? before.name,
          description: patch.description ?? before.description,
          priority: patch.priority ?? before.priority,
          emoji: marker.emoji,
          emojiKey: marker.key,
          revision: before.revision + 1,
          updatedAt: now,
        })
        .where(eq(projects.slug, projectSlug))
        .returning()
        .get();
      if (!after) throw domainError('INTERNAL_ERROR', 'Project update did not return its result');
      return projectMutationResult({ before, after, config, action: 'project.update' });
    },
  });
}
