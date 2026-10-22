import { and, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod/mini';
import { tasks } from '../../schema/entities.js';
import { occurrences } from '../../schema/recurrence.js';
import type { statisticsInputSchema } from '../../schema/read-views.js';
import { parseTimestamp } from '../time.js';
import { effectiveTaskDeadline, taskCategory, taskPredicates } from './task-query-sql.js';
export type StatisticsInput = z.output<typeof statisticsInputSchema>;
export const statisticCategories = [
  'not_started',
  'in_progress',
  'review',
  'completed',
  'cancelled',
  'draft',
  'active',
  'paused',
  'archived',
] as const;
export const statisticOutcomes = [
  'pending',
  'debt',
  'missed',
  'completed',
  'completed_late',
  'cancelled',
] as const;
function timestampRange(timestamp: SQL, input: StatisticsInput): SQL {
  const bounds: SQL[] = [];
  if (input.from !== undefined) bounds.push(sql`${timestamp} >= ${parseTimestamp(input.from)}`);
  if (input.to !== undefined) bounds.push(sql`${timestamp} < ${parseTimestamp(input.to)}`);
  return and(...bounds) ?? sql`1`;
}
function countMatching(condition: SQL): SQL<number> {
  return sql<number>`coalesce(sum(CASE WHEN ${condition} THEN 1 ELSE 0 END), 0)`;
}
export function statisticsPredicates(input: StatisticsInput, emoji: string | undefined) {
  return and(
    taskPredicates({ ...input, limit: 50, include_terminal: true }, emoji),
    input.include_terminal
      ? undefined
      : sql`(${tasks.kind} != 'ordinary' OR ${taskCategory} != 'cancelled')`,
  );
}
export function taskStatisticsSelection(input: StatisticsInput, asOf: number) {
  const range = timestampRange(effectiveTaskDeadline, input);
  const ordinary = sql`${tasks.kind} = 'ordinary'`;
  const unfinished = sql`${ordinary} AND ${taskCategory} IN ('not_started','in_progress','review')`;
  const categoryCount = (category: string) =>
    countMatching(sql`${range} AND ${taskCategory} = ${category}`);
  return {
    taskTotal: countMatching(range),
    byKind: {
      ordinary: countMatching(sql`${range} AND ${ordinary}`),
      recurring: countMatching(sql`${range} AND ${tasks.kind} = 'recurring'`),
    },
    byCategory: {
      not_started: categoryCount('not_started'),
      in_progress: categoryCount('in_progress'),
      review: categoryCount('review'),
      completed: categoryCount('completed'),
      cancelled: categoryCount('cancelled'),
      draft: categoryCount('draft'),
      active: categoryCount('active'),
      paused: categoryCount('paused'),
      archived: categoryCount('archived'),
    },
    ordinary: {
      unfinished: countMatching(sql`${range} AND ${unfinished}`),
      overdue: countMatching(
        sql`${range} AND ${unfinished} AND ${effectiveTaskDeadline} < ${asOf}`,
      ),
      completed: countMatching(sql`${ordinary} AND ${taskCategory} = 'completed'
        AND ${timestampRange(sql`${tasks.completionRecordedAt}`, input)}`),
    },
  };
}
export function occurrenceStatisticsSelection(input: StatisticsInput) {
  const timestamp = sql`CASE WHEN ${occurrences.state} IN ('completed','completed_late')
    THEN ${occurrences.completionRecordedAt} ELSE ${occurrences.deadline} END`;
  const range = timestampRange(timestamp, input);
  const count = (state: string) => countMatching(sql`${range} AND ${occurrences.state} = ${state}`);
  return {
    pending: count('pending'),
    debt: count('debt'),
    missed: count('missed'),
    completed: count('completed'),
    completed_late: count('completed_late'),
    cancelled: input.include_terminal ? count('cancelled') : sql<number>`0`,
    total: countMatching(
      input.include_terminal ? range : sql`${range} AND ${occurrences.state} != 'cancelled'`,
    ),
  };
}
