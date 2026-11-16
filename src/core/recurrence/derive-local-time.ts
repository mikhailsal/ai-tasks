import { Temporal } from '@js-temporal/polyfill';

/**
 * The local wall time of an instant in a zone, as a schedule `local_time` (spec 012 R2).
 * Every instant has exactly one local time, so derivation is never ambiguous.
 */
export function localTimeOf(instant: number, zone: string): string {
  const time = Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}.${pad(time.millisecond, 3)}`;
}
