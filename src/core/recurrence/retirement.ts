import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod/mini';
import { occurrences, recurrenceIntervals } from '../../schema/recurrence.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { nextCalendarDeadline } from './calendar.js';
import { closeRecurrenceInterval, currentRecurrence, type RecurringTask } from './generations.js';
import { advanceCalendar } from './calendar-enumeration.js';
import { expireTaskOccurrences } from './expire.js';
type RetirementOptions = {
  task: RecurringTask;
  now: number;
};
export function hasOwedCalendarSnapshot(options: {
  current: ReturnType<typeof currentRecurrence>;
  intervals: {
    startAt: number;
    endAt: number | null;
  }[];
  now: number;
}): boolean {
  const { state, generation, schedule } = options.current;
  const now = readClock(() => options.now);
  if (schedule.mode !== 'calendar' || (state.cursorAnchor !== null && state.cursorAnchor >= now))
    return false;
  if (options.intervals.length === 0) return false;
  const candidate =
    state.nextCandidateAt ??
    (state.cursorAnchor === null
      ? generation.firstDeadline
      : nextCalendarDeadline({
          schedule,
          anchor: state.cursorAnchor,
          timezone: generation.timezone,
        }));
  if (candidate > now) return false;
  return options.intervals.some(
    (interval) =>
      interval.startAt <= now &&
      (interval.endAt === null || interval.endAt > Math.max(candidate, interval.startAt)),
  );
}
/** A conservative read: unresolved candidates may belong to any remaining active interval.
 * Sparse schedules can require a tick to prove that an overlapping interval has no anchor. */
export function hasOwedCalendarAnchors(
  transaction: DatabaseTransaction,
  options: RetirementOptions,
): boolean {
  const now = readClock(() => options.now);
  const { task } = options;
  const current = currentRecurrence(transaction, task);
  const intervals = transaction
    .select({ startAt: recurrenceIntervals.startAt, endAt: recurrenceIntervals.endAt })
    .from(recurrenceIntervals)
    .where(
      and(
        eq(recurrenceIntervals.projectSlug, task.projectSlug),
        eq(recurrenceIntervals.taskId, task.id),
        eq(recurrenceIntervals.scheduleGenerationId, current.generation.id),
        eq(recurrenceIntervals.behavior, 'active'),
      ),
    )
    .all();
  return hasOwedCalendarSnapshot({ current, intervals, now });
}
function owedError(taskId: string) {
  return domainError(
    'VALIDATION_ERROR',
    'Run explicit recurrence ticks to reconcile owed anchors before changing or retiring this schedule',
    {
      reason: 'owed_anchors',
      action: 'tick',
      task_id: taskId,
    },
  );
}
/** Retiring a parent must neither hide unresolved anchors nor forgive existing work. */
export function assertRetirable(
  transaction: DatabaseTransaction,
  options: RetirementOptions,
): void {
  if (hasOwedCalendarAnchors(transaction, options)) throw owedError(options.task.id);
  const open = transaction
    .select({ id: occurrences.id, state: occurrences.state, deadline: occurrences.deadline })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.projectSlug, options.task.projectSlug),
        eq(occurrences.taskId, options.task.id),
        inArray(occurrences.state, ['pending', 'debt']),
      ),
    )
    .orderBy(asc(occurrences.deadline), asc(occurrences.id))
    .limit(1)
    .get();
  if (open)
    throw domainError(
      'VALIDATION_ERROR',
      'Close pending occurrences and debts before retiring this schedule; future pending rows must be explicitly cancelled while paused',
      {
        reason: 'open_occurrences',
        task_id: options.task.id,
        occurrence_id: open.id,
        state: open.state,
      },
    );
}
/** Lifecycle intervals end half-open. Timezone continuation includes the effective anchor
 * because its new generation starts strictly later. Neither path precreates old future work. */
export function reconcileBeforeGenerationChange(
  transaction: DatabaseTransaction,
  options: RetirementOptions & {
    limit?: number;
    includeEffectiveAnchor?: boolean;
  },
) {
  const now = readClock(() => options.now);
  if (options.includeEffectiveAnchor !== true)
    closeRecurrenceInterval(transaction, { taskId: options.task.id, now });
  const limit = parseInput(z.int().check(z.minimum(0)).check(z.maximum(128)), options.limit ?? 128);
  const expiry =
    limit > 0
      ? expireTaskOccurrences(transaction, { taskId: options.task.id, now, limit })
      : {
          events: [],
          processed: 0,
          hasMore:
            transaction
              .select({ id: occurrences.id })
              .from(occurrences)
              .where(
                and(
                  eq(occurrences.taskId, options.task.id),
                  eq(occurrences.state, 'pending'),
                  lt(occurrences.expiresAt, now),
                ),
              )
              .limit(1)
              .get() !== undefined,
        };
  const remaining = limit - expiry.processed;
  const calendar =
    remaining > 0 && hasOwedCalendarAnchors(transaction, { task: options.task, now })
      ? advanceCalendar(transaction, {
          task: options.task,
          now,
          limit: remaining,
          materializeFuture: false,
        })
      : { events: [], processed: 0 };
  if (expiry.hasMore || hasOwedCalendarAnchors(transaction, { task: options.task, now }))
    throw owedError(options.task.id);
  if (options.includeEffectiveAnchor === true)
    closeRecurrenceInterval(transaction, { taskId: options.task.id, now });
  return {
    events: [...expiry.events, ...calendar.events],
    processed: expiry.processed + calendar.processed,
    hasMore: false as const,
  };
}
