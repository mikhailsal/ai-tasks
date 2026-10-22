import { and, asc, eq, gt, isNull, lt, lte, max, min, or, sql } from 'drizzle-orm';
import type { z } from 'zod/mini';
import { dueWorkEnvelopeSchema, dueWorkInputSchema } from '../../schema/due-work.js';
import { tasks } from '../../schema/entities.js';
import {
  occurrences,
  recurrenceIntervals,
  recurrenceState,
  scheduleGenerations,
} from '../../schema/recurrence.js';
import { scheduleSchema } from '../../schema/recurrence-input.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { readProjectConfiguration, requireProject } from '../projects/read.js';
import { hasOwedCalendarSnapshot } from '../recurrence/retirement.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { queryMetadata, queryState } from './page.js';
function parentRows(transaction: DatabaseTransaction, slug: string) {
  return transaction
    .select({
      task: { id: tasks.id, revision: tasks.revision, statusId: tasks.statusId },
      state: recurrenceState,
      generation: scheduleGenerations,
    })
    .from(tasks)
    .innerJoin(recurrenceState, eq(recurrenceState.taskId, tasks.id))
    .innerJoin(scheduleGenerations, eq(scheduleGenerations.id, recurrenceState.currentGenerationId))
    .where(and(eq(tasks.projectSlug, slug), eq(tasks.kind, 'recurring'), isNull(tasks.archivedAt)))
    .orderBy(asc(tasks.id))
    .all();
}
function expiredParents(transaction: DatabaseTransaction, slug: string, now: number) {
  return new Set(
    transaction
      .select({ taskId: occurrences.taskId })
      .from(occurrences)
      .where(
        and(
          eq(occurrences.projectSlug, slug),
          eq(occurrences.state, 'pending'),
          lt(occurrences.expiresAt, now),
        ),
      )
      .groupBy(occurrences.taskId)
      .all()
      .map((row) => row.taskId),
  );
}
function accountedFutureParents(transaction: DatabaseTransaction, slug: string, now: number) {
  return new Set(
    transaction
      .select({ taskId: recurrenceState.taskId })
      .from(recurrenceState)
      .innerJoin(
        occurrences,
        and(
          eq(occurrences.generationId, recurrenceState.currentGenerationId),
          eq(occurrences.deadline, recurrenceState.cursorAnchor),
        ),
      )
      .where(and(eq(recurrenceState.projectSlug, slug), gt(recurrenceState.cursorAnchor, now)))
      .groupBy(recurrenceState.taskId)
      .all()
      .map((row) => row.taskId),
  );
}
function activeIntervals(transaction: DatabaseTransaction, slug: string, now: number) {
  // Empty intervals cannot own an anchor. For the conservative owed predicate, the
  // latest nonempty end (or an open interval) represents all qualifying old periods.
  const rows = transaction
    .select({
      taskId: recurrenceIntervals.taskId,
      startAt: min(recurrenceIntervals.startAt),
      endAt: max(recurrenceIntervals.endAt),
      open: sql<number>`max(case when ${recurrenceIntervals.endAt} is null then 1 else 0 end)`,
    })
    .from(recurrenceIntervals)
    .innerJoin(
      recurrenceState,
      and(
        eq(recurrenceState.taskId, recurrenceIntervals.taskId),
        eq(recurrenceState.currentGenerationId, recurrenceIntervals.scheduleGenerationId),
      ),
    )
    .where(
      and(
        eq(recurrenceIntervals.projectSlug, slug),
        eq(recurrenceIntervals.behavior, 'active'),
        lte(recurrenceIntervals.startAt, now),
        or(
          isNull(recurrenceIntervals.endAt),
          gt(recurrenceIntervals.endAt, recurrenceIntervals.startAt),
        ),
      ),
    )
    .groupBy(recurrenceIntervals.taskId)
    .all();
  return new Map(rows.map((row) => [row.taskId, row]));
}
function collapsedIntervals(
  interval:
    | {
        startAt: number | null;
        endAt: number | null;
        open: number;
      }
    | undefined,
) {
  if (interval === undefined || interval.startAt === null) return [];
  return [{ startAt: interval.startAt, endAt: interval.open === 1 ? null : interval.endAt }];
}
function dueParents(
  transaction: DatabaseTransaction,
  options: {
    slug: string;
    now: number;
    activeStatusIds: Set<string>;
  },
) {
  const expired = expiredParents(transaction, options.slug, options.now);
  const accounted = accountedFutureParents(transaction, options.slug, options.now);
  const intervals = activeIntervals(transaction, options.slug, options.now);
  return parentRows(transaction, options.slug).filter((row) => {
    if (expired.has(row.task.id)) return true;
    const schedule = scheduleSchema.safeParse(row.generation.schedule);
    if (!schedule.success || schedule.data.mode !== row.generation.mode)
      throw domainError('INTERNAL_ERROR', 'The stored schedule generation is invalid');
    if (schedule.data.mode !== 'calendar') return false;
    const interval = intervals.get(row.task.id);
    const active = options.activeStatusIds.has(row.task.statusId) && interval?.open === 1;
    const owed = hasOwedCalendarSnapshot({
      current: { state: row.state, generation: row.generation, schedule: schedule.data },
      intervals: collapsedIntervals(interval),
      now: options.now,
    });
    return owed || (active && !accounted.has(row.task.id));
  });
}
/** Discover with one captured clock and batched associations; never process due work here. */
export function discoverDueWork(
  context: Pick<CoreContext, 'connection' | 'now'>,
  projectSlug: string,
  input: z.input<typeof dueWorkInputSchema> = {},
) {
  const parsed = parseInput(dueWorkInputSchema, input);
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    const project = requireProject(transaction, projectSlug);
    const config = readProjectConfiguration(transaction, project);
    const activeStatusIds = new Set(
      config.recurring_workflow.statuses
        .filter((status) => status.category === 'active')
        .map((status) => status.id),
    );
    const candidates =
      project.archivedAt === null
        ? dueParents(transaction, { slug: project.slug, now, activeStatusIds })
        : [];
    return dueWorkEnvelopeSchema.parse({
      ok: true,
      data: {
        tasks: candidates
          .slice(0, parsed.limit)
          .map((row) => ({ task_id: row.task.id, expected_revision: row.task.revision })),
        expected_config_revision: project.configRevision,
        expected_settings_revision: state.revision,
        has_more: candidates.length > parsed.limit,
      },
      meta: queryMetadata(state, now),
    });
  });
}
