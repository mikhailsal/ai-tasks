import { Temporal } from '@js-temporal/polyfill';
import { calendarScheduleSchema, type CalendarSchedule } from '../../schema/recurrence-input.js';
import { timezoneSchema } from '../../schema/values.js';
import { domainError } from '../errors.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';

function nextDate(anchor: Temporal.PlainDate, schedule: CalendarSchedule) {
  if (schedule.pattern === 'days') return anchor.add({ days: schedule.every });
  if (schedule.pattern === 'weeks') return anchor.add({ days: 7 * schedule.every });
  if (schedule.pattern === 'months') {
    // Start at day one before advancing so February's clamp never changes the rule's day.
    return anchor
      .with({ day: 1 })
      .add({ months: schedule.every })
      .with({ day: schedule.day_of_month }, { overflow: 'constrain' });
  }
  if (schedule.pattern === 'weekdays') {
    for (let days = 1; days <= 7; days++) {
      const candidate = anchor.add({ days });
      if (schedule.weekdays.includes(candidate.dayOfWeek)) return candidate;
    }
  }
  throw domainError('VALIDATION_ERROR', 'A weekday schedule requires at least one weekday');
}

/** Generated local anchors use the earlier fold instant and shift gaps by their actual size. */
export function nextCalendarDeadline(options: {
  schedule: CalendarSchedule;
  anchor: number;
  timezone: string;
}): number {
  const schedule = parseInput(calendarScheduleSchema, options.schedule);
  const timezone = parseInput(timezoneSchema, options.timezone);
  const anchor = readClock(() => options.anchor);
  try {
    const date = Temporal.Instant.fromEpochMilliseconds(anchor)
      .toZonedDateTimeISO(timezone)
      .toPlainDate();
    const local = nextDate(date, schedule).toPlainDateTime(
      Temporal.PlainTime.from(schedule.local_time),
    );
    const result = local.toZonedDateTime(timezone, {
      disambiguation: 'compatible',
    }).epochMilliseconds;
    return readClock(() => result);
  } catch {
    throw domainError(
      'VALIDATION_ERROR',
      'The next calendar deadline is outside the supported date range',
    );
  }
}
