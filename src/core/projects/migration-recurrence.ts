import { and, eq, inArray } from 'drizzle-orm';
import { occurrences, recurrenceIntervals } from '../../schema/recurrence.js';
import type { AuditEvent } from '../audit/append.js';
import type { DatabaseTransaction } from '../database/types.js';
import { DomainError, domainError } from '../errors.js';
import { advanceCalendar, seedCurrentGeneration } from '../recurrence/calendar-enumeration.js';
import { currentRecurrence, setRecurrenceBehavior } from '../recurrence/generations.js';
import { assertRetirable, hasOwedCalendarAnchors } from '../recurrence/retirement.js';
import { resumeRecurrence, validateResumeRecurrence } from '../recurrence/resume.js';
import { nextCalendarDeadline } from '../recurrence/calendar.js';
import { readClock } from '../time.js';
import type { MigrationPlan, ProjectedTask } from './migration-types.js';

function behaviorChanges(task: ProjectedTask): boolean {
  return task.before.kind === 'recurring' && !task.unresolved && task.oldCategory !== task.category;
}

export function hasRecurringBehaviorChanges(plan: MigrationPlan): boolean {
  return plan.tasks.some(behaviorChanges);
}

function initialActivation(transaction: DatabaseTransaction, task: ProjectedTask): boolean {
  if (
    task.oldCategory !== 'draft' ||
    currentRecurrence(transaction, task.before).state.cursorAnchor !== null
  )
    return false;
  return (
    transaction
      .select({ id: recurrenceIntervals.id })
      .from(recurrenceIntervals)
      .where(
        and(
          eq(recurrenceIntervals.taskId, task.before.id),
          inArray(recurrenceIntervals.behavior, ['active', 'paused']),
        ),
      )
      .limit(1)
      .get() === undefined
  );
}

function validateInitialActivation(
  transaction: DatabaseTransaction,
  task: ProjectedTask,
  now: number,
) {
  const { generation, schedule } = currentRecurrence(transaction, task.before);
  const deadline = readClock(() => generation.firstDeadline);
  readClock(() => deadline + generation.windowMs);
  if (schedule.mode === 'calendar') {
    let candidate = nextCalendarDeadline({
      schedule,
      anchor: deadline,
      timezone: generation.timezone,
    });
    // Activation accounts for at most the same 128 anchors as advanceCalendar.
    // A future explicit seed already fulfills precreation and does not advance further.
    if (deadline <= now) {
      for (let count = 0; count < 128; count++) {
        if (candidate >= now) readClock(() => candidate + generation.windowMs);
        const accounted = candidate;
        candidate = nextCalendarDeadline({
          schedule,
          anchor: candidate,
          timezone: generation.timezone,
        });
        if (accounted > now) break;
      }
    }
  }
  const key = schedule.mode === 'calendar' ? `calendar:${deadline}` : `seed:${generation.id}`;
  const existing = transaction
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.taskId, task.before.id), eq(occurrences.deadline, deadline)))
    .get();
  if (existing && (existing.generationId !== generation.id || existing.occurrenceKey !== key))
    throw domainError('VALIDATION_ERROR', 'The declared seed collides with an existing occurrence');
}

/** Preview checks the same stored clocks/conditions without staging interval or outcome writes. */
export function validateRecurringMigration(
  transaction: DatabaseTransaction,
  plan: MigrationPlan,
): void {
  for (const task of plan.tasks.filter(behaviorChanges)) {
    try {
      if (task.category === 'archived')
        assertRetirable(transaction, { task: task.before, now: plan.now });
      if (task.category === 'active') {
        if (hasOwedCalendarAnchors(transaction, { task: task.before, now: plan.now }))
          throw domainError(
            'VALIDATION_ERROR',
            'Run explicit recurrence ticks before activating work through configuration',
          );
        if (initialActivation(transaction, task))
          validateInitialActivation(transaction, task, plan.now);
        else validateResumeRecurrence(transaction, { task: task.before, now: plan.now });
      }
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      plan.issues.push({ code: error.code, message: error.message, task_id: task.before.id });
    }
  }
}

/** Administrative mapping applies category semantics, without a user edge or confirmation. */
export function applyRecurringMigration(
  transaction: DatabaseTransaction,
  task: ProjectedTask,
  now: number,
): AuditEvent[] {
  if (!behaviorChanges(task)) return [];
  if (task.category === 'archived') assertRetirable(transaction, { task: task.before, now });
  if (task.category === 'active' && !initialActivation(transaction, task))
    return resumeRecurrence(transaction, { task: task.before, now }).events;
  const behavior = task.category;
  if (
    behavior !== 'draft' &&
    behavior !== 'active' &&
    behavior !== 'paused' &&
    behavior !== 'archived'
  )
    throw domainError('INTERNAL_ERROR', 'The projected recurring behavior is invalid');
  const current = currentRecurrence(transaction, task.before);
  setRecurrenceBehavior(transaction, {
    task: task.before,
    generationId: current.generation.id,
    behavior,
    now,
  });
  if (behavior !== 'active') return [];
  return [
    ...seedCurrentGeneration(transaction, { task: task.before, now }).events,
    ...advanceCalendar(transaction, { task: task.before, now }).events,
  ];
}
