import type { JsonValue } from '../schema/values.js';

type JsonObject = Record<string, JsonValue>;
function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** «7 ч 30 мин» for a duration in minutes (spec 008 R6). */
export function humanDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} мин`;
  return rest === 0 ? `${String(hours)} ч` : `${String(hours)} ч ${String(rest)} мин`;
}

function humanValues(values: JsonValue | undefined): string {
  if (!isObject(values)) return '';
  const parts = Object.entries(values).flatMap(([name, entry]) => {
    if (!isObject(entry)) return [];
    const shown =
      entry.kind === 'duration' && typeof entry.value === 'number'
        ? humanDuration(entry.value)
        : String(entry.value);
    return [`${name} ${shown}`];
  });
  return parts.length === 0 ? '' : `; значения: ${parts.join(' · ')}`;
}

/** One occurrence line with its day, reason, note and values (specs 007 US4, 008 US1/US2). */
export function humanOccurrence(value: JsonObject): string {
  const text = (label: string, field: JsonValue | undefined) =>
    typeof field === 'string' ? `; ${label}: ${field}` : '';
  return `${String(value.id)} ${String(value.state)} ${String(value.deadline)}${text('день', value.occurrence_day)}${text('причина пропуска', value.miss_reason)}${text('заметка', value.completion_note)}${text('причина отмены', value.cancel_reason)}${humanValues(value.recorded_values)}`;
}

/** «6 из 7» with the breakdown in 006's words (spec 008 R6). */
export function humanProgress(value: JsonObject): string | undefined {
  const breakdown = value.breakdown;
  if (typeof value.decided !== 'number' || !isObject(breakdown)) return undefined;
  return [
    `${String(value.from_day)} – ${String(value.to_day)}: ${String(value.done)} из ${String(value.decided)}`,
    `вовремя ${String(breakdown.completed)} · записано после окна ${String(breakdown.completed_late)} · пропуск ${String(breakdown.missed)} · долг ${String(breakdown.debt)} · открыто ${String(value.open)}`,
  ].join('\n');
}
