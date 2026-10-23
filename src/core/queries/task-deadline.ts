import { Temporal } from '@js-temporal/polyfill';
import { and, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod/mini';
import type { taskListInputSchema } from '../../schema/task-query.js';
import { domainError } from '../errors.js';
type DeadlineQuery = Pick<z.output<typeof taskListInputSchema>, 'deadline_preset' | 'deadline_day'>;
type DeadlineReferences = { deadline: SQL; kind: SQL; category: SQL };
function calendarBounds(input: DeadlineQuery, reference: { asOf: number; timezone: string }) {
  try {
    const day =
      input.deadline_day === undefined
        ? Temporal.Instant.fromEpochMilliseconds(reference.asOf)
            .toZonedDateTimeISO(reference.timezone)
            .toPlainDate()
        : Temporal.PlainDate.from(input.deadline_day, { overflow: 'reject' });
    const midnight = (days: number) =>
      day.add({ days }).toZonedDateTime(reference.timezone).epochMilliseconds;
    return { start: midnight(0), tomorrow: midnight(1), third: midnight(3) };
  } catch {
    throw domainError('VALIDATION_ERROR', 'Deadline day is outside the supported calendar range');
  }
}
/** Relative bounds use the cursor's captured time; calendar days follow DST, never a fixed 24h. */
export function taskDeadlinePredicate(
  options: { input: DeadlineQuery; asOf: number; timezone: string },
  refs: DeadlineReferences,
): SQL | undefined {
  const { input, asOf } = options;
  if (input.deadline_day === undefined && input.deadline_preset === undefined) return;
  if (input.deadline_preset === 'undated') return sql`${refs.deadline} IS NULL`;
  if (input.deadline_preset === 'overdue')
    return sql`${refs.deadline} < ${asOf} AND (${refs.kind} = 'recurring'
      OR ${refs.category} IN ('not_started','in_progress','review'))`;
  const bounds = calendarBounds(input, options);
  if (input.deadline_preset === 'from_tomorrow') return sql`${refs.deadline} >= ${bounds.tomorrow}`;
  const end = input.deadline_preset === 'next_3_days' ? bounds.third : bounds.tomorrow;
  return and(sql`${refs.deadline} >= ${bounds.start}`, sql`${refs.deadline} < ${end}`);
}
