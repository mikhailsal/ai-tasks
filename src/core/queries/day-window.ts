import { and, gte, lte, type SQL } from 'drizzle-orm';
import { MAX_DAY_WINDOW } from '../../schema/occurrence-values.js';
import { occurrences } from '../../schema/recurrence.js';
import { domainError } from '../errors.js';
import { dayCount } from '../recurrence/day.js';

export type DayWindow = { from: string; to: string };

/** Checks an inclusive window of days: ordered and at most 366 days (spec 008 R3, R5). */
export function checkDayWindow(from: string, to: string): DayWindow {
  const days = dayCount(from, to);
  if (days < 1)
    throw domainError('VALIDATION_ERROR', 'from_day must not be after to_day', {
      field: 'from_day',
    });
  if (days > MAX_DAY_WINDOW)
    throw domainError(
      'VALIDATION_ERROR',
      `A window of days may span at most ${String(MAX_DAY_WINDOW)} days`,
      { field: 'to_day', maximum: MAX_DAY_WINDOW },
    );
  return { from, to };
}

/** `day`, or `from_day` with `to_day`, from an occurrence list input; undefined for no filter. */
export function listDayWindow(input: {
  day?: string | undefined;
  from_day?: string | undefined;
  to_day?: string | undefined;
}): DayWindow | undefined {
  const ranged = input.from_day !== undefined || input.to_day !== undefined;
  if (input.day !== undefined && ranged)
    throw domainError('VALIDATION_ERROR', 'Use either day or from_day and to_day, not both', {
      field: 'day',
    });
  if (input.day !== undefined) return { from: input.day, to: input.day };
  if (!ranged) return undefined;
  if (input.from_day === undefined || input.to_day === undefined)
    throw domainError('VALIDATION_ERROR', 'from_day and to_day go together', {
      field: input.from_day === undefined ? 'from_day' : 'to_day',
    });
  return checkDayWindow(input.from_day, input.to_day);
}

export function dayCondition(window: DayWindow | undefined): SQL | undefined {
  if (!window) return undefined;
  return and(
    gte(occurrences.occurrenceDay, window.from),
    lte(occurrences.occurrenceDay, window.to),
  );
}
