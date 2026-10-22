import { Temporal } from '@js-temporal/polyfill';
import { and, eq, gte, lt, or } from 'drizzle-orm';
import type { CalendarSchedule } from '../../schema/recurrence-input.js';
import { occurrences, recurrenceState } from '../../schema/recurrence.js';
import type { AuditEvent } from '../audit/append.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { parseTimestamp, readClock } from '../time.js';
import { advanceCalendar, seedCurrentGeneration } from './calendar-enumeration.js';
import { nextCalendarDeadline } from './calendar.js';
import { nextElapsedDeadline } from './elapsed.js';
import {
  currentRecurrence,
  publishGeneration,
  recurrenceSettings,
  setRecurrenceBehavior,
  type RecurringTask,
} from './generations.js';
import { reconcileBeforeGenerationChange } from './retirement.js';
import { createCompletionSuccessor } from './successors.js';
import type { OccurrenceRow } from './snapshots.js';

type ResumeOptions = { task: RecurringTask; now: number; firstDeadline?: string };
type CalendarSeek = {
  schedule: CalendarSchedule;
  timezone: string;
  candidate: number;
  now: number;
};

function calendarJump(options: CalendarSeek): number {
  if (options.candidate > options.now) return options.candidate;
  const anchor = Temporal.Instant.fromEpochMilliseconds(options.candidate)
    .toZonedDateTimeISO(options.timezone)
    .toPlainDate();
  const today = Temporal.Instant.fromEpochMilliseconds(options.now)
    .toZonedDateTimeISO(options.timezone)
    .toPlainDate();
  const rule = options.schedule;
  let date: Temporal.PlainDate | undefined;
  if (rule.pattern === 'months') {
    const months = (today.year - anchor.year) * 12 + today.month - anchor.month;
    const steps = Math.floor(months / rule.every);
    if (steps > 0)
      date = anchor
        .with({ day: 1 })
        .add({ months: steps * rule.every })
        .with({ day: rule.day_of_month }, { overflow: 'constrain' });
  } else {
    const days = anchor.until(today, { largestUnit: 'days' }).days;
    if (rule.pattern === 'weekdays') {
      if (days > 0) date = today.subtract({ days: 1 });
    } else {
      const interval = rule.every * (rule.pattern === 'weeks' ? 7 : 1);
      const steps = Math.floor(days / interval);
      if (steps > 0) date = anchor.add({ days: steps * interval });
    }
  }
  if (!date) return nextCalendarDeadline({ ...options, anchor: options.candidate });
  const jumped = date
    .toPlainDateTime(Temporal.PlainTime.from(rule.local_time))
    .toZonedDateTime(options.timezone, { disambiguation: 'compatible' }).epochMilliseconds;
  if (rule.pattern !== 'weekdays' && jumped > options.now) return readClock(() => jumped);
  return nextCalendarDeadline({ ...options, anchor: jumped });
}

/** Jump calendar cycles, stopping at zone transitions so whole-day gaps retain cadence. */
export function futureCalendarCandidate(options: CalendarSeek): number {
  let candidate = options.candidate;
  let transition = Temporal.Instant.fromEpochMilliseconds(candidate)
    .toZonedDateTimeISO(options.timezone)
    .getTimeZoneTransition('next');
  while (transition !== null && transition.epochMilliseconds <= options.now) {
    candidate = calendarJump({ ...options, candidate, now: transition.epochMilliseconds - 1 });
    if (candidate > options.now) return candidate;
    transition = transition.add({ milliseconds: 1 }).getTimeZoneTransition('next');
  }
  return calendarJump({ ...options, candidate });
}

function openActive(
  transaction: DatabaseTransaction,
  options: ResumeOptions,
  generationId: string,
) {
  setRecurrenceBehavior(transaction, {
    task: options.task,
    generationId,
    behavior: 'active',
    now: options.now,
  });
}

function assertCandidateAvailable(
  transaction: DatabaseTransaction,
  taskId: string,
  candidate: number,
  identity?: { generationId: string; key: string },
) {
  const collision = transaction
    .select({
      id: occurrences.id,
      generationId: occurrences.generationId,
      key: occurrences.occurrenceKey,
    })
    .from(occurrences)
    .where(and(eq(occurrences.taskId, taskId), eq(occurrences.deadline, candidate)))
    .get();
  if (
    collision &&
    (collision.generationId !== identity?.generationId || collision.key !== identity?.key)
  )
    throw domainError(
      'VALIDATION_ERROR',
      'This parent already has an occurrence at the resumed deadline',
      { occurrence_id: collision.id },
    );
}

function calendarResumeCandidate(transaction: DatabaseTransaction, options: ResumeOptions) {
  if (options.firstDeadline !== undefined)
    throw domainError('VALIDATION_ERROR', 'Calendar rescheduling uses explicit configuration');
  const { state, generation, schedule } = currentRecurrence(transaction, options.task);
  if (schedule.mode !== 'calendar')
    throw domainError('INTERNAL_ERROR', 'A calendar schedule is required');
  const accounted =
    state.cursorAnchor !== null && state.cursorAnchor > options.now
      ? transaction
          .select({ id: occurrences.id })
          .from(occurrences)
          .where(
            and(
              eq(occurrences.generationId, generation.id),
              eq(occurrences.deadline, state.cursorAnchor),
            ),
          )
          .get()
      : undefined;
  if (accounted) return { state, generation, candidate: undefined };
  const candidate =
    state.nextCandidateAt ??
    (state.cursorAnchor === null
      ? generation.firstDeadline
      : nextCalendarDeadline({
          schedule,
          anchor: state.cursorAnchor,
          timezone: generation.timezone,
        }));
  const future = futureCalendarCandidate({
    schedule,
    timezone: generation.timezone,
    candidate,
    now: options.now,
  });
  readClock(() => future + generation.windowMs);
  nextCalendarDeadline({ schedule, anchor: future, timezone: generation.timezone });
  assertCandidateAvailable(transaction, options.task.id, future, {
    generationId: generation.id,
    key: `calendar:${future}`,
  });
  return { state, generation, candidate: future };
}

function resumeCalendar(transaction: DatabaseTransaction, options: ResumeOptions) {
  const plan = calendarResumeCandidate(transaction, options);
  if (plan.candidate !== undefined)
    transaction
      .update(recurrenceState)
      .set({ nextCandidateAt: plan.candidate, revision: plan.state.revision + 1 })
      .where(eq(recurrenceState.taskId, options.task.id))
      .run();
  openActive(transaction, options, plan.generation.id);
  return advanceCalendar(transaction, options).events;
}

function restartElapsed(transaction: DatabaseTransaction, options: ResumeOptions) {
  if (options.firstDeadline === undefined)
    throw domainError(
      'VALIDATION_ERROR',
      'Supply a future first deadline before resuming this parent',
    );
  const current = currentRecurrence(transaction, options.task);
  const generation = publishGeneration(transaction, {
    task: options.task,
    now: options.now,
    entry: 'restart',
    timezone: recurrenceSettings(transaction).timezone,
    input: {
      first_deadline: options.firstDeadline,
      schedule: current.schedule,
      miss_policy: current.generation.missPolicy,
      confirmation_window_ms: current.generation.windowMs,
    },
  });
  openActive(transaction, options, generation.id);
  return seedCurrentGeneration(transaction, options).events;
}

function unchangedDeadline(options: ResumeOptions) {
  if (options.firstDeadline !== undefined)
    throw domainError(
      'VALIDATION_ERROR',
      'This resume preserves the existing work or derived candidate',
    );
}

type ElapsedDecision =
  | { kind: 'retain' }
  | { kind: 'seed' }
  | { kind: 'restart' }
  | { kind: 'successor'; predecessor: OccurrenceRow };

function explicitRestart(
  transaction: DatabaseTransaction,
  options: ResumeOptions,
  windowMs: number,
): ElapsedDecision {
  if (options.firstDeadline === undefined)
    throw domainError(
      'VALIDATION_ERROR',
      'Supply a future first deadline before resuming this parent',
    );
  const first = parseTimestamp(options.firstDeadline);
  if (first <= options.now)
    throw domainError('VALIDATION_ERROR', 'A resumed first deadline must be future');
  readClock(() => first + windowMs);
  assertCandidateAvailable(transaction, options.task.id, first);
  return { kind: 'restart' };
}

function elapsedResumeDecision(
  transaction: DatabaseTransaction,
  options: ResumeOptions,
): ElapsedDecision {
  const { state, generation, schedule } = currentRecurrence(transaction, options.task);
  if (schedule.mode !== 'after_completion')
    throw domainError('INTERNAL_ERROR', 'An elapsed schedule is required');
  // Preview interprets captured expiry without persisting an outcome or an audit event.
  const open = transaction
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.generationId, generation.id),
        or(
          eq(occurrences.state, 'debt'),
          and(
            eq(occurrences.state, 'pending'),
            or(
              gte(occurrences.expiresAt, options.now),
              eq(occurrences.missPolicy, 'carry_forward'),
            ),
          ),
        ),
      ),
    )
    .limit(1)
    .get();
  if (open) {
    unchangedDeadline(options);
    return { kind: 'retain' };
  }
  if (state.waitingPredecessorId === null) {
    if (generation.firstDeadline <= options.now)
      return explicitRestart(transaction, options, generation.windowMs);
    unchangedDeadline(options);
    readClock(() => generation.firstDeadline + generation.windowMs);
    assertCandidateAvailable(transaction, options.task.id, generation.firstDeadline, {
      generationId: generation.id,
      key: `seed:${generation.id}`,
    });
    return { kind: 'seed' };
  }
  const predecessor = transaction
    .select()
    .from(occurrences)
    .where(eq(occurrences.id, state.waitingPredecessorId))
    .get();
  if (!predecessor || predecessor.generationId !== generation.id)
    throw domainError('INTERNAL_ERROR', 'The elapsed waiting predecessor has invalid ownership');
  if (predecessor.state === 'cancelled')
    return explicitRestart(transaction, options, generation.windowMs);
  if (predecessor.actualCompletedAt === null) {
    unchangedDeadline(options);
    return { kind: 'retain' };
  }
  const candidate = nextElapsedDeadline({
    schedule,
    actualCompletedAt: predecessor.actualCompletedAt,
  });
  if (candidate <= options.now) return explicitRestart(transaction, options, generation.windowMs);
  unchangedDeadline(options);
  readClock(() => candidate + generation.windowMs);
  return { kind: 'successor', predecessor };
}

/** Eligibility only: preview must not advance a cursor, expire a row, or open an interval. */
export function validateResumeRecurrence(
  transaction: DatabaseTransaction,
  options: ResumeOptions,
): void {
  const checked = { ...options, now: readClock(() => options.now) };
  const expiryBacklog = transaction
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.taskId, options.task.id),
        eq(occurrences.state, 'pending'),
        lt(occurrences.expiresAt, checked.now),
      ),
    )
    .limit(129)
    .all();
  if (expiryBacklog.length > 128)
    throw domainError('VALIDATION_ERROR', 'Run scoped ticks before resuming this parent', {
      reason: 'owed_anchors',
      action: 'tick',
      task_id: options.task.id,
    });
  if (currentRecurrence(transaction, options.task).schedule.mode === 'calendar')
    calendarResumeCandidate(transaction, checked);
  else elapsedResumeDecision(transaction, checked);
}

function resumeElapsed(transaction: DatabaseTransaction, options: ResumeOptions): AuditEvent[] {
  const plan = elapsedResumeDecision(transaction, options);
  if (plan.kind === 'restart') return restartElapsed(transaction, options);
  const { generation, schedule } = currentRecurrence(transaction, options.task);
  if (schedule.mode !== 'after_completion')
    throw domainError('INTERNAL_ERROR', 'An elapsed schedule is required');
  openActive(transaction, options, generation.id);
  if (plan.kind === 'retain') return [];
  if (plan.kind === 'seed') return seedCurrentGeneration(transaction, options).events;
  return createCompletionSuccessor(transaction, {
    task: options.task,
    generation,
    schedule,
    predecessor: plan.predecessor,
    now: options.now,
    active: true,
  }).events;
}

/** The lifecycle command owns edge/confirmation validation and the parent status write. */
export function resumeRecurrence(
  transaction: DatabaseTransaction,
  options: ResumeOptions,
): { events: AuditEvent[] } {
  const now = readClock(() => options.now);
  const checked = { ...options, now };
  const events = reconcileBeforeGenerationChange(transaction, checked).events;
  const { schedule } = currentRecurrence(transaction, options.task);
  return {
    events: [
      ...events,
      ...(schedule.mode === 'calendar'
        ? resumeCalendar(transaction, checked)
        : resumeElapsed(transaction, checked)),
    ],
  };
}
