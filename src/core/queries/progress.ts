import { and, count, eq } from 'drizzle-orm';
import { progressEnvelopeSchema, progressInputSchema } from '../../schema/occurrence-values.js';
import { occurrences } from '../../schema/recurrence.js';
import type { CoreContext } from '../database/types.js';
import { requireProject } from '../projects/read.js';
import { requireRecurring } from '../recurrence/generations.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { checkDayWindow, dayCondition } from './day-window.js';
import { queryMetadata, queryState } from './page.js';

/**
 * Goal progress over an inclusive window of days (spec 008 R5): done is completed plus
 * completed_late, decided adds missed and owed, open is pending, cancelled is left out.
 */
export function occurrenceProgress(
  context: Pick<CoreContext, 'connection' | 'now'>,
  projectSlug: string,
  taskId: string,
  input: unknown,
) {
  const parsed = parseInput(progressInputSchema, input);
  const window = checkDayWindow(parsed.from_day, parsed.to_day);
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    requireProject(transaction, projectSlug);
    const task = requireRecurring(transaction, projectSlug, taskId);
    const groups = transaction
      .select({ state: occurrences.state, count: count() })
      .from(occurrences)
      .where(and(eq(occurrences.taskId, task.id), dayCondition(window)))
      .groupBy(occurrences.state)
      .all();
    const of = (name: string) => groups.find((group) => group.state === name)?.count ?? 0;
    const breakdown = {
      completed: of('completed'),
      completed_late: of('completed_late'),
      missed: of('missed'),
      debt: of('debt'),
    };
    const done = breakdown.completed + breakdown.completed_late;
    return progressEnvelopeSchema.parse({
      ok: true,
      data: {
        task_id: task.id,
        from_day: window.from,
        to_day: window.to,
        done,
        decided: done + breakdown.missed + breakdown.debt,
        open: of('pending'),
        breakdown,
      },
      meta: queryMetadata(state, now),
    });
  });
}
