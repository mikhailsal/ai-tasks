import { and, asc, eq } from 'drizzle-orm';
import * as z from 'zod/mini';
import { occurrences, recurrenceIntervals, recurrenceState } from '../../schema/recurrence.js';
import type { CalendarSchedule } from '../../schema/recurrence-input.js';
import type { AuditEvent } from '../audit/append.js';
import type { DatabaseTransaction } from '../database/types.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { nextCalendarDeadline } from './calendar.js';
import { expireOccurrence } from './expire.js';
import { currentRecurrence, type RecurringTask } from './generations.js';
import { materializeOccurrence } from './snapshots.js';
type ActiveInterval = typeof recurrenceIntervals.$inferSelect;
const batchLimit = z.int().check(z.minimum(1)).check(z.maximum(128));
function futureAnchorExists(
  transaction: DatabaseTransaction,
  options: {
    generationId: string;
    cursor: number | null;
    now: number;
  },
) {
  if (options.cursor === null || options.cursor <= options.now) return false;
  return (
    transaction
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(
        and(
          eq(occurrences.generationId, options.generationId),
          eq(occurrences.deadline, options.cursor),
        ),
      )
      .get() !== undefined
  );
}
function initialCandidate(options: {
  state: typeof recurrenceState.$inferSelect;
  generation: ReturnType<typeof currentRecurrence>['generation'];
  schedule: CalendarSchedule;
}) {
  if (options.state.nextCandidateAt !== null) return options.state.nextCandidateAt;
  if (options.state.cursorAnchor === null) return options.generation.firstDeadline;
  return nextCalendarDeadline({
    schedule: options.schedule,
    anchor: options.state.cursorAnchor,
    timezone: options.generation.timezone,
  });
}
function unfinished(options: {
  processed: number;
  limit: number;
  candidate: number;
  now: number;
  intervals: ActiveInterval[];
  cursor: number | null;
}) {
  if (options.cursor !== null && options.cursor > options.now) return false;
  return (
    options.processed === options.limit &&
    (options.candidate <= options.now || activeAt(options.intervals, options.candidate))
  );
}
function activeAt(intervals: ActiveInterval[], instant: number): boolean {
  return intervals.some(
    (interval) =>
      interval.startAt <= instant && (interval.endAt === null || instant < interval.endAt),
  );
}
function stopAtCandidate(options: {
  candidate: number;
  now: number;
  active: boolean;
  materializeFuture: boolean | undefined;
}) {
  return (
    options.candidate > options.now && (!options.active || options.materializeFuture === false)
  );
}
/** Each visited anchor is checkpointed with its rows, even when its interval is skipped. */
export function advanceCalendar(
  transaction: DatabaseTransaction,
  options: {
    task: RecurringTask;
    now: number;
    limit?: number;
    materializeFuture?: boolean;
  },
) {
  const now = readClock(() => options.now);
  const limit = parseInput(batchLimit, options.limit ?? 128);
  const { task } = options;
  const { state, generation, schedule } = currentRecurrence(transaction, task);
  const events: AuditEvent[] = [];
  if (schedule.mode !== 'calendar') return { events, processed: 0, hasMore: false };
  const intervals = transaction
    .select()
    .from(recurrenceIntervals)
    .where(
      and(
        eq(recurrenceIntervals.taskId, task.id),
        eq(recurrenceIntervals.scheduleGenerationId, generation.id),
        eq(recurrenceIntervals.behavior, 'active'),
      ),
    )
    .orderBy(asc(recurrenceIntervals.startAt))
    .all();
  if (intervals.length === 0) return { events, processed: 0, hasMore: false };
  // A future anchor already accounted for is the single precreated future period.
  if (
    futureAnchorExists(transaction, {
      generationId: generation.id,
      cursor: state.cursorAnchor,
      now,
    })
  )
    return { events, processed: 0, hasMore: false };
  const next = (anchor: number) =>
    nextCalendarDeadline({ schedule, anchor, timezone: generation.timezone });
  let cursor = state.cursorAnchor;
  let candidate = initialCandidate({ state, generation, schedule });
  let processed = 0;
  while (processed < limit) {
    const active = activeAt(intervals, candidate);
    if (stopAtCandidate({ candidate, now, active, materializeFuture: options.materializeFuture }))
      break;
    if (active) {
      const created = materializeOccurrence(transaction, {
        task,
        generation,
        deadline: candidate,
        key: `calendar:${candidate}`,
        now,
      });
      const expired = expireOccurrence(transaction, { row: created.row, now });
      events.push(...created.events, ...expired.events);
    }
    cursor = candidate;
    candidate = next(candidate);
    processed++;
    if (cursor > now) break;
  }
  if (cursor !== state.cursorAnchor || candidate !== state.nextCandidateAt)
    transaction
      .update(recurrenceState)
      .set({
        cursorAnchor: cursor,
        nextCandidateAt: candidate,
        revision: state.revision + 1,
      })
      .where(eq(recurrenceState.taskId, task.id))
      .run();
  const hasMore = unfinished({ processed, limit, candidate, now, intervals, cursor });
  return { events, processed, hasMore };
}
/** Activation/restart supplies its explicit seed; ordinary ticks never invent a seed. */
export function seedCurrentGeneration(
  transaction: DatabaseTransaction,
  options: {
    task: RecurringTask;
    now: number;
    deadline?: number;
  },
) {
  const { state, generation, schedule } = currentRecurrence(transaction, options.task);
  const deadline = options.deadline ?? generation.firstDeadline;
  const created = materializeOccurrence(transaction, {
    task: options.task,
    generation,
    deadline,
    key: schedule.mode === 'calendar' ? `calendar:${deadline}` : `seed:${generation.id}`,
    now: options.now,
  });
  const expired = expireOccurrence(transaction, { row: created.row, now: options.now });
  const calendar = schedule.mode === 'calendar';
  transaction
    .update(recurrenceState)
    .set({
      cursorAnchor: deadline,
      nextCandidateAt: calendar
        ? nextCalendarDeadline({ schedule, anchor: deadline, timezone: generation.timezone })
        : null,
      waitingPredecessorId: calendar ? null : created.row.id,
      revision: state.revision + 1,
    })
    .where(eq(recurrenceState.taskId, options.task.id))
    .run();
  return { row: expired.row, events: [...created.events, ...expired.events] };
}
