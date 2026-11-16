import type { OccurrenceResource } from '../../../src/schema/recurrence-query.js';

/** «7 ч 30 мин» for a duration in minutes (spec 008 R6). */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} мин`;
  return rest === 0 ? `${String(hours)} ч` : `${String(hours)} ч ${String(rest)} мин`;
}

/** «asleep_at 23:40 · slept 7 ч 30 мин», with the declared names as labels. */
export function recordedValuesLabel(values: OccurrenceResource['recorded_values']): string {
  if (!values) return '';
  return Object.entries(values)
    .map(([name, entry]) =>
      entry.kind === 'duration' && typeof entry.value === 'number'
        ? `${name} ${durationLabel(entry.value)}`
        : `${name} ${String(entry.value)}`,
    )
    .join(' · ');
}

/** Today's calendar date in a zone, YYYY-MM-DD. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The day `days` before `day`, YYYY-MM-DD. */
export function shiftDay(day: string, days: number): string {
  const time = Date.parse(`${day}T00:00:00.000Z`) + days * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}
