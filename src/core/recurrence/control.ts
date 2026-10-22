import { and, eq, inArray } from 'drizzle-orm';
import { tasks, type projects } from '../../schema/entities.js';
import type { ProjectConfigInput } from '../../schema/configuration.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { controlRecurrenceSchema, recurrenceInputSchema } from '../../schema/recurrence-input.js';
import { recurrenceIntervals } from '../../schema/recurrence.js';
import { confirmationSchema, taskDetailSchema } from '../../schema/tasks.js';
import { jsonValueSchema, type JsonValue } from '../../schema/values.js';
import type { AuditEvent } from '../audit/append.js';
import { executeMutation } from '../database/mutate.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError, normalizeError } from '../errors.js';
import { readProjectConfiguration, requireProject } from '../projects/read.js';
import { syncTaskEmoji } from '../tasks/emoji.js';
import { assertProjectActive, taskStatus } from '../tasks/read.js';
import { taskMutationResult } from '../tasks/write.js';
import { formatTimestamp } from '../time.js';
import { parseInput } from '../validation.js';
import { advanceCalendar, seedCurrentGeneration } from './calendar-enumeration.js';
import {
  currentRecurrence,
  publishGeneration,
  recurrenceSettings,
  requireRecurring,
  setRecurrenceBehavior,
  type RecurringTask,
  type ScheduleGeneration,
} from './generations.js';
import { assertRetirable, reconcileBeforeGenerationChange } from './retirement.js';
import { resumeRecurrence } from './resume.js';

export function recurrenceConfiguration(generation: ScheduleGeneration) {
  return {
    generation_id: generation.id,
    generation_number: generation.generationNumber,
    first_deadline: formatTimestamp(generation.firstDeadline),
    schedule: generation.schedule,
    timezone: generation.timezone,
    miss_policy: generation.missPolicy,
    confirmation_window_ms: generation.windowMs,
  };
}

function commandContext(transaction: DatabaseTransaction, projectSlug: string, id: string) {
  const project = requireProject(transaction, projectSlug);
  assertProjectActive(project);
  const task = requireRecurring(transaction, projectSlug, id);
  const config = readProjectConfiguration(transaction, project);
  return { project, task, config };
}

export function recurrenceConfirmation(required: boolean, value: unknown) {
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

function generationChangeEvent(
  events: AuditEvent[],
  options: { before: ScheduleGeneration; after: ScheduleGeneration },
) {
  if (options.before.id === options.after.id) return events;
  return events.map((event) => ({
    ...event,
    changes: [
      ...event.changes,
      {
        field: 'recurrence',
        before: recurrenceConfiguration(options.before),
        after: recurrenceConfiguration(options.after),
      },
    ],
  }));
}

export function configureRecurrence(
  context: CoreContext,
  projectSlug: string,
  taskId: string,
  input: MutationEnvelope,
) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'recurrence.configure',
    input,
    guards: { entity: { type: 'task', id: taskId }, settings: true },
    handler(transaction, now) {
      const command = commandContext(transaction, projectSlug, taskId);
      const before = command.task;
      const status = taskStatus(before, command.config);
      if (before.archivedAt !== null || status.category === 'archived')
        throw domainError('VALIDATION_ERROR', 'Archived tasks are read-only');
      const payload = parseInput(recurrenceInputSchema, input.payload);
      const old = currentRecurrence(transaction, before).generation;
      const reconciled = reconcileBeforeGenerationChange(transaction, { task: before, now });
      const generation = publishGeneration(transaction, {
        task: before,
        input: payload,
        now,
        timezone: recurrenceSettings(transaction).timezone,
        entry: status.category === 'active' ? 'restart' : 'paused',
      });
      if (!['draft', 'active', 'paused'].includes(status.category))
        throw domainError('INTERNAL_ERROR', 'Invalid recurring configuration category');
      const behavior = command.config.recurring_workflow.statuses.find(
        (item) => item.id === before.statusId,
      );
      if (!behavior) throw domainError('INTERNAL_ERROR', 'The recurring status is missing');
      setRecurrenceBehavior(transaction, {
        task: before,
        generationId: generation.id,
        behavior: behavior.category,
        now,
      });
      const seeded =
        status.category === 'active'
          ? seedCurrentGeneration(transaction, { task: before, now }).events
          : [];
      const after = transaction
        .update(tasks)
        .set({ revision: before.revision + 1, updatedAt: now })
        .where(eq(tasks.id, taskId))
        .returning()
        .get();
      if (!after) throw domainError('INTERNAL_ERROR', 'Recurrence configuration returned no task');
      const result = taskMutationResult(transaction, {
        before,
        after,
        project: command.project,
        config: command.config,
        action: 'recurrence.configure',
      });
      return {
        data: { ...recurrenceConfiguration(generation), task_id: taskId, revision: after.revision },
        events: [
          ...reconciled.events,
          ...seeded,
          ...generationChangeEvent(result.events, { before: old, after: generation }),
        ],
      };
    },
  });
}

type RecurrenceMove = {
  task: RecurringTask;
  project: typeof projects.$inferSelect;
  config: ProjectConfigInput;
  payload: {
    to_status_id: string;
    confirmation?: JsonValue | undefined;
    first_deadline?: string | undefined;
  };
  now: number;
  action: string;
  marker?: {
    replacement_emoji?: string | undefined;
    emoji_collision?: 'reject' | 'use_default' | undefined;
  };
};

function configuredMove(options: RecurrenceMove) {
  const source = taskStatus(options.task, options.config);
  const workflow = options.config.recurring_workflow;
  const target = workflow.statuses.find((item) => item.id === options.payload.to_status_id);
  const edge = workflow.transitions.find(
    (item) => item.from === options.task.statusId && item.to === options.payload.to_status_id,
  );
  if (!target || !edge)
    throw domainError('VALIDATION_ERROR', 'This transition is not in the recurring workflow');
  if (source.category === 'archived' && target.id !== workflow.restore_status_id)
    throw domainError(
      'VALIDATION_ERROR',
      'Recurring restoration uses the configured paused status',
    );
  if (options.task.archivedAt !== null && source.category !== 'archived')
    throw domainError('VALIDATION_ERROR', 'Archived tasks are read-only');
  const confirmation = recurrenceConfirmation(
    edge.requires_confirmation,
    options.payload.confirmation,
  );
  if (
    options.payload.first_deadline !== undefined &&
    !(source.category === 'paused' && target.category === 'active')
  )
    throw domainError(
      'VALIDATION_ERROR',
      'A restart seed is available only when resuming paused work',
    );
  return { source, target, confirmation };
}

function changeBehavior(
  transaction: DatabaseTransaction,
  options: RecurrenceMove,
  move: ReturnType<typeof configuredMove>,
) {
  const events: AuditEvent[] = [];
  if (move.target.category === 'archived')
    assertRetirable(transaction, { task: options.task, now: options.now });
  if (move.source.category === move.target.category) return events;
  if (resumingActivation(transaction, options, move))
    return resumeRecurrence(transaction, {
      task: options.task,
      now: options.now,
      ...(options.payload.first_deadline === undefined
        ? {}
        : { firstDeadline: options.payload.first_deadline }),
    }).events;
  const current = currentRecurrence(transaction, options.task);
  setRecurrenceBehavior(transaction, {
    task: options.task,
    generationId: current.generation.id,
    behavior: move.target.category,
    now: options.now,
  });
  if (move.source.category === 'draft' && move.target.category === 'active') {
    events.push(
      ...seedCurrentGeneration(transaction, { task: options.task, now: options.now }).events,
    );
    events.push(...advanceCalendar(transaction, { task: options.task, now: options.now }).events);
  }
  return events;
}

function resumingActivation(
  transaction: DatabaseTransaction,
  options: RecurrenceMove,
  move: ReturnType<typeof configuredMove>,
) {
  if (move.target.category !== 'active') return false;
  if (move.source.category === 'paused') return true;
  if (move.source.category !== 'draft') return false;
  if (currentRecurrence(transaction, options.task).state.cursorAnchor !== null) return true;
  return (
    transaction
      .select({ id: recurrenceIntervals.id })
      .from(recurrenceIntervals)
      .where(
        and(
          eq(recurrenceIntervals.taskId, options.task.id),
          inArray(recurrenceIntervals.behavior, ['active', 'paused']),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

/** Shared transactional lifecycle for recurrence controls and direct task commands. */
export function applyRecurrenceTransition(
  transaction: DatabaseTransaction,
  options: RecurrenceMove,
) {
  const move = configuredMove(options);
  const markerPolicy = recurringMarkerPolicy(options, move);
  const old = currentRecurrence(transaction, options.task).generation;
  const events = changeBehavior(transaction, options, move);
  const marker = syncTaskEmoji(transaction, {
    projectSlug: options.task.projectSlug,
    taskId: options.task.id,
    ...markerPolicy,
  });
  const after = transaction
    .update(tasks)
    .set({
      statusId: move.target.id,
      archivedAt: move.target.category === 'archived' ? options.now : null,
      emoji: marker.emoji,
      emojiKey: marker.key,
      revision: options.task.revision + 1,
      updatedAt: options.now,
    })
    .where(eq(tasks.id, options.task.id))
    .returning()
    .get();
  if (!after) throw domainError('INTERNAL_ERROR', 'Recurrence control returned no task');
  const result = taskMutationResult(transaction, {
    before: options.task,
    after,
    project: options.project,
    config: options.config,
    action: options.action,
    ...(move.confirmation === undefined ? {} : { confirmation: move.confirmation }),
  });
  const generation = currentRecurrence(transaction, after).generation;
  return {
    data: jsonValueSchema.parse({
      ...taskDetailSchema.parse(result.data),
      recurrence: recurrenceConfiguration(generation),
    }),
    events: [
      ...events,
      ...generationChangeEvent(result.events, { before: old, after: generation }),
    ],
  };
}

function recurringMarkerPolicy(options: RecurrenceMove, move: ReturnType<typeof configuredMove>) {
  const returning = move.source.category === 'archived';
  if (!returning && options.marker?.emoji_collision === 'use_default')
    throw domainError(
      'VALIDATION_ERROR',
      'Default marker fallback applies only when returning work',
    );
  const collision = returning
    ? (options.marker?.emoji_collision ??
      (options.marker?.replacement_emoji === undefined ? 'use_default' : 'reject'))
    : 'reject';
  return {
    emoji: options.marker?.replacement_emoji ?? options.task.emoji,
    reserve: move.target.category !== 'archived',
    collision,
  } as const;
}

export function controlRecurrence(
  context: CoreContext,
  projectSlug: string,
  taskId: string,
  input: MutationEnvelope,
) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'recurrence.control',
    input,
    guards: { entity: { type: 'task', id: taskId }, settings: true },
    handler(transaction, now) {
      const command = commandContext(transaction, projectSlug, taskId);
      const payload = parseInput(controlRecurrenceSchema, input.payload);
      return applyRecurrenceTransition(transaction, {
        ...command,
        payload,
        now,
        action: 'recurrence.control',
      });
    },
  });
}
