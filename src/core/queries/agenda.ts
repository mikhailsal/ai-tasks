import { Temporal } from '@js-temporal/polyfill';
import { asc, sql } from 'drizzle-orm';
import type { z } from 'zod/mini';
import { tasks } from '../../schema/entities.js';
import type { agendaInputSchema } from '../../schema/read-views.js';
import { agendaPageEnvelopeSchema, type bucketSchema } from '../../schema/read-views.js';
import type { CoreContext } from '../database/types.js';
import { domainError } from '../errors.js';
import { readTaskPage, type TaskPageRow } from './task-page.js';
import { effectiveTaskDeadline, taskCategory } from './task-query-sql.js';
import { groupTaskRows } from './task-view-groups.js';
type Boundaries = {
  todayEnd: number;
  next7End: number;
};
function boundaries(asOf: number, timezone: string): Boundaries {
  try {
    const today = Temporal.Instant.fromEpochMilliseconds(asOf)
      .toZonedDateTimeISO(timezone)
      .toPlainDate();
    return {
      todayEnd: today.add({ days: 1 }).toZonedDateTime(timezone).epochMilliseconds,
      next7End: today.add({ days: 8 }).toZonedDateTime(timezone).epochMilliseconds,
    };
  } catch {
    throw domainError(
      'VALIDATION_ERROR',
      'The agenda calendar boundaries are outside the supported range',
    );
  }
}
function bucketOrder(asOf: number, timezone: string) {
  const { todayEnd, next7End } = boundaries(asOf, timezone);
  return [
    asc(sql`CASE
    WHEN ${effectiveTaskDeadline} IS NULL THEN 4
    WHEN ${effectiveTaskDeadline} < ${asOf} AND (${tasks.kind} = 'recurring'
      OR ${taskCategory} IN ('not_started','in_progress','review')) THEN 0
    WHEN ${effectiveTaskDeadline} < ${todayEnd} THEN 1
    WHEN ${effectiveTaskDeadline} < ${next7End} THEN 2
    ELSE 3 END`),
  ];
}
function agendaBucket(
  row: TaskPageRow,
  asOf: number,
  bounds: Boundaries,
): z.infer<typeof bucketSchema> {
  const deadline = row.task.display_deadline;
  if (deadline === null) return 'no_deadline';
  const instant = Date.parse(deadline);
  const unfinished =
    row.task.kind === 'recurring' ||
    ['not_started', 'in_progress', 'review'].includes(row.task.category);
  if (instant < asOf && unfinished) return 'overdue';
  if (instant < bounds.todayEnd) return 'today';
  if (instant < bounds.next7End) return 'next_7_days';
  return 'later';
}
export function listAgenda(
  context: Pick<CoreContext, 'connection' | 'now'>,
  input: z.input<typeof agendaInputSchema>,
) {
  const page = readTaskPage(context, input, { family: 'agenda', precedingOrder: bucketOrder });
  const bounds = boundaries(page.asOf, page.timezone);
  return agendaPageEnvelopeSchema.parse({
    ok: true,
    data: {
      groups: groupTaskRows(page.rows, (row) => ({
        ...row.task,
        agenda_bucket: agendaBucket(row, page.asOf, bounds),
      })),
      next_cursor: page.nextCursor,
    },
    meta: page.meta,
  });
}
