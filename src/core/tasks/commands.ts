import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { tasks } from '../../schema/entities.js';
import type { ProjectConfigInput } from '../../schema/configuration.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import {
  taskCreateSchema,
  taskPatchSchema,
  taskArchiveSchema,
  taskRestoreSchema,
} from '../../schema/tasks.js';
import { executeMutation } from '../database/mutate.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { renderMarkdown, RENDER_POLICY_VERSION } from '../markdown/render.js';
import { requireProject, readProjectConfiguration } from '../projects/read.js';
import { priorityColumns } from '../projects/priorities.js';
import { parseTimestamp } from '../time.js';
import { publishGeneration, recurrenceSettings } from '../recurrence/generations.js';
import {
  assertRecurrenceSettings,
  createdTaskMutationResult,
  moveRecurringTask,
  recurringArchiveTarget,
} from './recurrence-write.js';
import { parseInput } from '../validation.js';
import { assertPrerequisitesSatisfied } from './dependencies-read.js';
import { DEFAULT_TASK_EMOJI, syncTaskEmoji } from './emoji.js';
import { assertProjectActive, requireTask, taskStatus } from './read.js';
import { taskMutationResult } from './write.js';

function priorityFields(value: unknown, config: ProjectConfigInput) {
  return priorityColumns(value, config.priority_model);
}

function activeTask(transaction: DatabaseTransaction, projectSlug: string, id: string) {
  const task = requireTask(transaction, projectSlug, id);
  if (task.archivedAt !== null)
    throw domainError('VALIDATION_ERROR', 'Archived tasks are read-only');
  return task;
}

function reservesMarker(category: string): boolean {
  return category !== 'completed' && category !== 'cancelled';
}

export function createTask(context: CoreContext, projectSlug: string, input: MutationEnvelope) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'task.create',
    input,
    handler(transaction, now) {
      const project = requireProject(transaction, projectSlug);
      assertProjectActive(project);
      const config = readProjectConfiguration(transaction, project);
      const data = parseInput(taskCreateSchema, input.payload);
      if (data.kind === 'recurring') assertRecurrenceSettings(transaction, input);
      const initial =
        data.kind === 'ordinary'
          ? config.ordinary_workflow.initial_status_id
          : config.recurring_workflow.initial_status_id;
      if (data.status_id !== undefined && data.status_id !== initial)
        throw domainError('VALIDATION_ERROR', 'New tasks require the configured initial status');
      const source = data.description ?? '';
      const created = transaction
        .insert(tasks)
        .values({
          id: randomUUID(),
          projectSlug,
          kind: data.kind,
          title: data.title,
          description: source,
          descriptionHtml: renderMarkdown(source),
          renderPolicyVersion: RENDER_POLICY_VERSION,
          statusId: initial,
          ...priorityFields(data.priority ?? null, config),
          deadline:
            data.kind === 'ordinary' && data.deadline ? parseTimestamp(data.deadline) : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      const marker = syncTaskEmoji(transaction, {
        projectSlug,
        taskId: created.id,
        emoji: data.emoji ?? DEFAULT_TASK_EMOJI,
        reserve: true,
      });
      const after = transaction
        .update(tasks)
        .set({ emoji: marker.emoji, emojiKey: marker.key })
        .where(eq(tasks.id, created.id))
        .returning()
        .get();
      if (!after) throw domainError('INTERNAL_ERROR', 'Task creation did not return its result');
      if (data.kind === 'recurring')
        publishGeneration(transaction, {
          task: after,
          input: data.recurrence,
          timezone: recurrenceSettings(transaction).timezone,
          now,
          entry: 'initial',
        });
      return createdTaskMutationResult(transaction, {
        before: null,
        after,
        project,
        config,
        action: 'task.create',
      });
    },
  });
}

export function updateTask(
  context: CoreContext,
  projectSlug: string,
  id: string,
  input: MutationEnvelope,
) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'task.update',
    input,
    guards: { entity: { type: 'task', id } },
    handler(transaction, now) {
      const project = requireProject(transaction, projectSlug);
      assertProjectActive(project);
      const before = activeTask(transaction, projectSlug, id);
      const config = readProjectConfiguration(transaction, project);
      const patch = parseInput(taskPatchSchema, input.payload);
      if (before.kind === 'recurring' && patch.deadline !== undefined)
        throw domainError(
          'VALIDATION_ERROR',
          'Recurring parent deadlines are derived from occurrences',
        );
      const status = taskStatus(before, config);
      const marker = syncTaskEmoji(transaction, {
        projectSlug,
        taskId: id,
        emoji: patch.emoji ?? before.emoji,
        reserve: reservesMarker(status.category),
      });
      const source = patch.description ?? before.description;
      const after = transaction
        .update(tasks)
        .set({
          title: patch.title ?? before.title,
          description: source,
          descriptionHtml: renderMarkdown(source),
          renderPolicyVersion: RENDER_POLICY_VERSION,
          emoji: marker.emoji,
          emojiKey: marker.key,
          ...priorityFields(
            patch.priority === undefined ? before.priority : patch.priority,
            config,
          ),
          deadline:
            patch.deadline === undefined
              ? before.deadline
              : patch.deadline === null
                ? null
                : parseTimestamp(patch.deadline),
          revision: before.revision + 1,
          updatedAt: now,
        })
        .where(eq(tasks.id, id))
        .returning()
        .get();
      if (!after) throw domainError('INTERNAL_ERROR', 'Task update did not return its result');
      return taskMutationResult(transaction, {
        before,
        after,
        project,
        config,
        action: 'task.update',
      });
    },
  });
}

export function archiveTask(
  context: CoreContext,
  projectSlug: string,
  id: string,
  input: MutationEnvelope,
) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'task.archive',
    input,
    guards: { entity: { type: 'task', id } },
    handler(transaction, now) {
      const project = requireProject(transaction, projectSlug);
      assertProjectActive(project);
      const before = activeTask(transaction, projectSlug, id);
      const config = readProjectConfiguration(transaction, project);
      const data = parseInput(taskArchiveSchema, input.payload);
      if (before.kind === 'recurring')
        return moveRecurringTask(transaction, {
          task: before,
          project,
          config,
          input,
          data: { to_status_id: recurringArchiveTarget(config, before.statusId), ...data },
          now,
          action: 'task.archive',
        });
      if (data.confirmation !== undefined)
        throw domainError('VALIDATION_ERROR', 'Ordinary archival has no transition confirmation');
      syncTaskEmoji(transaction, { projectSlug, taskId: id, emoji: before.emoji, reserve: false });
      const after = transaction
        .update(tasks)
        .set({ archivedAt: now, revision: before.revision + 1, updatedAt: now })
        .where(eq(tasks.id, id))
        .returning()
        .get();
      if (!after) throw domainError('INTERNAL_ERROR', 'Task archive did not return its result');
      return taskMutationResult(transaction, {
        before,
        after,
        project,
        config,
        action: 'task.archive',
      });
    },
  });
}

export function restoreTask(
  context: CoreContext,
  projectSlug: string,
  id: string,
  input: MutationEnvelope,
) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'task.restore',
    input,
    guards: { entity: { type: 'task', id } },
    handler(transaction, now) {
      const project = requireProject(transaction, projectSlug);
      assertProjectActive(project);
      const before = requireTask(transaction, projectSlug, id);
      const config = readProjectConfiguration(transaction, project);
      const data = parseInput(taskRestoreSchema, input.payload);
      if (before.archivedAt === null) throw domainError('VALIDATION_ERROR', 'Task is not archived');
      if (before.kind === 'recurring')
        return moveRecurringTask(transaction, {
          task: before,
          project,
          config,
          input,
          data: { to_status_id: config.recurring_workflow.restore_status_id, ...data },
          now,
          action: 'task.restore',
        });
      if (data.confirmation !== undefined)
        throw domainError(
          'VALIDATION_ERROR',
          'Ordinary restoration has no transition confirmation',
        );
      const status = taskStatus(before, config);
      assertPrerequisitesSatisfied(transaction, id, status.category);
      const marker = syncTaskEmoji(transaction, {
        projectSlug,
        taskId: id,
        emoji: data.replacement_emoji ?? before.emoji,
        reserve: reservesMarker(status.category),
        collision:
          data.emoji_collision ?? (data.replacement_emoji === undefined ? 'use_default' : 'reject'),
      });
      const after = transaction
        .update(tasks)
        .set({
          archivedAt: null,
          emoji: marker.emoji,
          emojiKey: marker.key,
          revision: before.revision + 1,
          updatedAt: now,
        })
        .where(eq(tasks.id, id))
        .returning()
        .get();
      if (!after) throw domainError('INTERNAL_ERROR', 'Task restoration did not return its result');
      return taskMutationResult(transaction, {
        before,
        after,
        project,
        config,
        action: 'task.restore',
      });
    },
  });
}
