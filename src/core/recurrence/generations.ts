import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, max } from 'drizzle-orm';
import { applicationState, type tasks } from '../../schema/entities.js';
import {
  occurrences,
  recurrenceIntervals,
  recurrenceState,
  scheduleGenerations,
} from '../../schema/recurrence.js';
import {
  recurrenceInputSchema,
  scheduleSchema,
  type RecurrenceInput,
} from '../../schema/recurrence-input.js';
import { timezoneSchema } from '../../schema/values.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { requireTask } from '../tasks/read.js';
import { parseTimestamp, readClock } from '../time.js';
import { parseInput } from '../validation.js';

export type RecurringTask = typeof tasks.$inferSelect;
export type ScheduleGeneration = typeof scheduleGenerations.$inferSelect;
type GenerationEntry =
  | { entry: 'initial' | 'restart' | 'paused' }
  | { entry: 'timezone'; continuationAnchor: number; nextCandidate: number | null };

export function requireRecurring(
  transaction: DatabaseTransaction,
  projectSlug: string,
  taskId: string,
) {
  const task = requireTask(transaction, projectSlug, taskId);
  if (task.kind !== 'recurring')
    throw domainError('VALIDATION_ERROR', 'The operation requires a recurring parent');
  return task;
}

export function readGeneration(transaction: DatabaseTransaction, id: string) {
  const generation = transaction
    .select()
    .from(scheduleGenerations)
    .where(eq(scheduleGenerations.id, id))
    .get();
  if (!generation) throw domainError('INTERNAL_ERROR', 'The stored schedule generation is missing');
  const parsed = scheduleSchema.safeParse(generation.schedule);
  if (!parsed.success || parsed.data.mode !== generation.mode)
    throw domainError('INTERNAL_ERROR', 'The stored schedule generation is invalid');
  return { generation, schedule: parsed.data };
}

export function currentRecurrence(transaction: DatabaseTransaction, task: RecurringTask) {
  const state = transaction
    .select()
    .from(recurrenceState)
    .where(
      and(eq(recurrenceState.projectSlug, task.projectSlug), eq(recurrenceState.taskId, task.id)),
    )
    .get();
  if (!state) throw domainError('INTERNAL_ERROR', 'The recurring checkpoint is missing');
  const current = readGeneration(transaction, state.currentGenerationId);
  if (current.generation.taskId !== task.id || current.generation.projectSlug !== task.projectSlug)
    throw domainError('INTERNAL_ERROR', 'The schedule generation has invalid ownership');
  return { state, ...current };
}

export function recurrenceSettings(transaction: DatabaseTransaction) {
  const state = transaction.select().from(applicationState).where(eq(applicationState.id, 1)).get();
  if (!state) throw domainError('INTERNAL_ERROR', 'Application settings are unavailable');
  return state;
}

export function hasOpenOccurrences(transaction: DatabaseTransaction, taskId: string): boolean {
  return (
    transaction
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(and(eq(occurrences.taskId, taskId), inArray(occurrences.state, ['pending', 'debt'])))
      .limit(1)
      .get() !== undefined
  );
}

function assertGenerationChange(
  transaction: DatabaseTransaction,
  options: {
    task: RecurringTask;
    input: RecurrenceInput;
    entry: 'initial' | 'restart' | 'paused' | 'timezone';
    now: number;
  },
) {
  const first = parseTimestamp(options.input.first_deadline);
  if (options.entry === 'restart' && first <= options.now)
    throw domainError('VALIDATION_ERROR', 'An active restart requires a future first deadline');
  if (options.entry === 'initial') return;
  const current = currentRecurrence(transaction, options.task);
  if (
    options.entry === 'timezone' &&
    (current.schedule.mode !== 'calendar' || options.input.schedule.mode !== 'calendar')
  )
    throw domainError(
      'VALIDATION_ERROR',
      'Timezone continuation applies only to calendar schedules',
    );
  if (
    current.schedule.mode !== options.input.schedule.mode &&
    hasOpenOccurrences(transaction, options.task.id)
  )
    throw domainError(
      'VALIDATION_ERROR',
      'A timing-mode change requires no pending or debt occurrences',
    );
  if (options.entry !== 'timezone') {
    const collision = transaction
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(and(eq(occurrences.taskId, options.task.id), eq(occurrences.deadline, first)))
      .get();
    if (collision)
      throw domainError(
        'VALIDATION_ERROR',
        'The first deadline collides with an existing occurrence',
        { occurrence_id: collision.id },
      );
  }
}

/** Callers reconcile old owed anchors before publishing a replacement generation. */
export function publishGeneration(
  transaction: DatabaseTransaction,
  options: {
    task: RecurringTask;
    input: RecurrenceInput;
    timezone: string;
    now: number;
  } & GenerationEntry,
) {
  if (options.task.kind !== 'recurring')
    throw domainError('VALIDATION_ERROR', 'Only recurring parents have schedule generations');
  const input = parseInput(recurrenceInputSchema, options.input);
  const timezone = parseInput(timezoneSchema, options.timezone);
  const now = readClock(() => options.now);
  assertGenerationChange(transaction, { ...options, input, now });
  const prior = transaction
    .select()
    .from(recurrenceState)
    .where(eq(recurrenceState.taskId, options.task.id))
    .get();
  if ((options.entry === 'initial') !== (prior === undefined))
    throw domainError('INTERNAL_ERROR', 'Generation initialization does not match the checkpoint');
  const checkpoint = generationCheckpoint(options, prior);
  const highest =
    transaction
      .select({ value: max(scheduleGenerations.generationNumber) })
      .from(scheduleGenerations)
      .where(eq(scheduleGenerations.taskId, options.task.id))
      .get()?.value ?? 0;
  const generation = transaction
    .insert(scheduleGenerations)
    .values({
      id: randomUUID(),
      taskId: options.task.id,
      projectSlug: options.task.projectSlug,
      generationNumber: highest + 1,
      mode: input.schedule.mode,
      schedule: input.schedule,
      firstDeadline: parseTimestamp(input.first_deadline),
      timezone,
      missPolicy: input.miss_policy,
      windowMs: input.confirmation_window_ms,
      createdAt: now,
    })
    .returning()
    .get();
  if (prior)
    transaction
      .update(scheduleGenerations)
      .set({ successorGenerationId: generation.id })
      .where(eq(scheduleGenerations.id, prior.currentGenerationId))
      .run();
  const state = { ...checkpoint, currentGenerationId: generation.id };
  transaction
    .insert(recurrenceState)
    .values({
      taskId: options.task.id,
      projectSlug: options.task.projectSlug,
      ...state,
    })
    .onConflictDoUpdate({
      target: [recurrenceState.projectSlug, recurrenceState.taskId],
      set: state,
    })
    .run();
  return generation;
}

function generationCheckpoint(
  options: { input: RecurrenceInput; now: number } & GenerationEntry,
  prior: typeof recurrenceState.$inferSelect | undefined,
) {
  let cursor: number | null = null;
  let next: number | null =
    options.entry === 'paused' ? null : parseTimestamp(options.input.first_deadline);
  if (options.entry === 'timezone') {
    cursor = readClock(() => options.continuationAnchor);
    next = options.nextCandidate;
    if (cursor < Math.max(options.now, prior?.cursorAnchor ?? options.now))
      throw domainError(
        'VALIDATION_ERROR',
        'Timezone continuation must follow the effective change and prior anchor',
      );
    const candidate = options.nextCandidate;
    if (candidate !== null && readClock(() => candidate) <= cursor)
      throw domainError(
        'VALIDATION_ERROR',
        'Timezone continuation requires a strictly later candidate',
      );
  }
  return {
    cursorAnchor: cursor,
    waitingPredecessorId: null,
    nextCandidateAt: next,
    revision: (prior?.revision ?? 0) + 1,
  };
}

/** Close the previous half-open interval before changing behavior or generation. */
export function setRecurrenceBehavior(
  transaction: DatabaseTransaction,
  options: {
    task: RecurringTask;
    generationId: string;
    behavior: 'draft' | 'active' | 'paused' | 'archived';
    now: number;
  },
) {
  const now = readClock(() => options.now);
  closeRecurrenceInterval(transaction, { taskId: options.task.id, now });
  if (options.behavior !== 'draft')
    transaction
      .insert(recurrenceIntervals)
      .values({
        id: randomUUID(),
        taskId: options.task.id,
        projectSlug: options.task.projectSlug,
        startAt: now,
        endAt: null,
        behavior: options.behavior,
        scheduleGenerationId: options.generationId,
      })
      .run();
}

export function closeRecurrenceInterval(
  transaction: DatabaseTransaction,
  options: { taskId: string; now: number },
) {
  const now = readClock(() => options.now);
  transaction
    .update(recurrenceIntervals)
    .set({ endAt: now })
    .where(and(eq(recurrenceIntervals.taskId, options.taskId), isNull(recurrenceIntervals.endAt)))
    .run();
}
