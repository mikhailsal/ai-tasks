import * as z from 'zod/mini';
import { statisticsCounters } from '../../schema/read-views.js';
import { statisticCategories, statisticOutcomes } from './statistics-sql.js';
const counterSchema = z.strictObject(statisticsCounters);
type Counters = z.output<typeof counterSchema>;
export function emptyStatistics(): Counters {
  return {
    tasks: {
      total: 0,
      by_kind: { ordinary: 0, recurring: 0 },
      by_category: {
        not_started: 0,
        in_progress: 0,
        review: 0,
        completed: 0,
        cancelled: 0,
        draft: 0,
        active: 0,
        paused: 0,
        archived: 0,
      },
    },
    ordinary: { unfinished: 0, overdue: 0, completed: 0 },
    occurrences: {
      pending: 0,
      debt: 0,
      missed: 0,
      completed: 0,
      completed_late: 0,
      cancelled: 0,
      total: 0,
    },
  };
}
export function totalStatistics(groups: Counters[]): Counters {
  const total = emptyStatistics();
  for (const group of groups) {
    total.tasks.total += group.tasks.total;
    total.tasks.by_kind.ordinary += group.tasks.by_kind.ordinary;
    total.tasks.by_kind.recurring += group.tasks.by_kind.recurring;
    for (const category of statisticCategories)
      total.tasks.by_category[category] += group.tasks.by_category[category];
    total.ordinary.unfinished += group.ordinary.unfinished;
    total.ordinary.overdue += group.ordinary.overdue;
    total.ordinary.completed += group.ordinary.completed;
    for (const outcome of statisticOutcomes)
      total.occurrences[outcome] += group.occurrences[outcome];
    total.occurrences.total += group.occurrences.total;
  }
  return counterSchema.parse(total);
}
