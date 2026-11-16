import { Temporal } from '@js-temporal/polyfill';

/**
 * The day an occurrence belongs to (spec 008 R2): the local date of its deadline in the
 * generation's zone, where a project day starts at `startHour` local time. A deadline before
 * that hour belongs to the previous day; one exactly at it belongs to the day it starts.
 * Wall-clock comparison keeps 23 and 25 hour days right, because the zone rules decide.
 */
export function occurrenceDay(deadline: number, zone: string, startHour = 0): string {
  const local = Temporal.Instant.fromEpochMilliseconds(deadline).toZonedDateTimeISO(zone);
  const date = local.toPlainDate();
  return (local.hour < startHour ? date.subtract({ days: 1 }) : date).toString();
}

/** Days from `from` to `to` inclusive; negative when `to` is before `from`. */
export function dayCount(from: string, to: string): number {
  return (
    Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: 'days' }).days +
    1
  );
}
