import { eq } from 'drizzle-orm';
import { tasks } from '../../schema/entities.js';
import { confirmationSchema, taskTransitionSchema } from '../../schema/tasks.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { executeMutation } from '../database/mutate.js';
import type { CoreContext } from '../database/types.js';
import { domainError, normalizeError } from '../errors.js';
import { readProjectConfiguration, requireProject } from '../projects/read.js';
import { parseInput } from '../validation.js';
import { assertPrerequisitesSatisfied } from './dependencies-read.js';
import { syncTaskEmoji } from './emoji.js';
import { assertProjectActive, requireTask, taskStatus } from './read.js';
import { taskMutationResult } from './write.js';
import { moveRecurringTask } from './recurrence-write.js';
import { completionRecordedAt } from './completion-time.js';

function transitionConfirmation(required: boolean, value: unknown) {
  if (value === undefined && !required) return;
  const parsed = confirmationSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (required && !parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys'))
    throw domainError(
      'CONFIRMATION_REQUIRED',
      'Provide the user’s confirmation for this transition',
    );
  throw normalizeError(parsed.error);
}

function markerPolicy(options: {
  sourceCategory: string;
  targetCategory: string;
  replacement: string | undefined;
  collision: 'reject' | 'use_default' | undefined;
}) {
  const wasTerminal = ['completed', 'cancelled'].includes(options.sourceCategory);
  const reserve = !['completed', 'cancelled'].includes(options.targetCategory);
  const returning = wasTerminal && reserve;
  if (!returning && options.collision === 'use_default')
    throw domainError(
      'VALIDATION_ERROR',
      'Default emoji fallback applies only when returning work',
    );
  const collision = returning
    ? (options.collision ?? (options.replacement === undefined ? 'use_default' : 'reject'))
    : 'reject';
  return { reserve, collision } as const;
}

export function transitionTask(
  context: CoreContext,
  projectSlug: string,
  taskId: string,
  input: MutationEnvelope,
) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'task.transition',
    input,
    guards: { entity: { type: 'task', id: taskId } },
    handler(transaction, now) {
      const project = requireProject(transaction, projectSlug);
      assertProjectActive(project);
      const before = requireTask(transaction, projectSlug, taskId);
      const payload = parseInput(taskTransitionSchema, input.payload);
      const config = readProjectConfiguration(transaction, project);
      if (before.kind === 'recurring')
        return moveRecurringTask(transaction, {
          task: before,
          project,
          config,
          input,
          data: payload,
          now,
          action: 'task.transition',
        });
      if (before.archivedAt !== null)
        throw domainError('VALIDATION_ERROR', 'Archived tasks are read-only');
      const source = taskStatus(before, config);
      const target = config.ordinary_workflow.statuses.find(
        (status) => status.id === payload.to_status_id,
      );
      const edge = config.ordinary_workflow.transitions.find(
        (value) => value.from === before.statusId && value.to === payload.to_status_id,
      );
      if (!target || !edge)
        throw domainError('VALIDATION_ERROR', 'This transition is not in the project workflow');
      const confirmation = transitionConfirmation(edge.requires_confirmation, payload.confirmation);
      assertPrerequisitesSatisfied(transaction, taskId, target.category);
      const policy = markerPolicy({
        sourceCategory: source.category,
        targetCategory: target.category,
        replacement: payload.replacement_emoji,
        collision: payload.emoji_collision,
      });
      const marker = syncTaskEmoji(transaction, {
        projectSlug,
        taskId,
        emoji: payload.replacement_emoji ?? before.emoji,
        ...policy,
      });
      const after = transaction
        .update(tasks)
        .set({
          statusId: target.id,
          completionRecordedAt: completionRecordedAt(before, source.category, target.category, now),
          emoji: marker.emoji,
          emojiKey: marker.key,
          revision: before.revision + 1,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .returning()
        .get();
      if (!after) throw domainError('INTERNAL_ERROR', 'Task transition returned no result');
      return taskMutationResult(transaction, {
        before,
        after,
        project,
        config,
        action: 'task.transition',
        ...(confirmation === undefined ? {} : { confirmation }),
      });
    },
  });
}
