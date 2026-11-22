import * as z from 'zod/mini';
import {
  occurrenceStateSchema,
  type RecurrenceResource,
  type OccurrenceResource,
} from '../../../src/schema/recurrence-query.js';
import { revisionSchema, uuidSchema, timestampSchema } from '../../../src/schema/values.js';
import { resolveLocalDeadline } from '../data/local-time.js';
export const occurrenceFieldsSchema = z.strictObject({
  selected: z.array(
    z.strictObject({
      id: uuidSchema,
      revision: revisionSchema,
      state: occurrenceStateSchema,
      deadline: timestampSchema,
      date: z.string(),
      time: z.string(),
      offset: z.string(),
    }),
  ),
  reason: z.string(),
  timezone: z.string(),
});
export type OccurrenceFields = z.infer<typeof occurrenceFieldsSchema>;
export type SelectedOccurrence = OccurrenceFields['selected'][number];
/**
 * One tap would replace the selection: never when another row is selected, nor when this row
 * already carries an actual completion time the person entered.
 */
export function selectionBlocksQuick(selected: readonly SelectedOccurrence[], id: string) {
  return selected.some(
    (item) => item.id !== id || item.date !== '' || item.time !== '' || item.offset !== '',
  );
}
/** A row selected with no actual completion time: the server records the current time. */
export function selectionFromRow(row: OccurrenceResource): SelectedOccurrence {
  return {
    id: row.id,
    revision: row.revision,
    state: row.state,
    deadline: row.deadline,
    date: '',
    time: '',
    offset: '',
  };
}
export function occurrenceBase(recurrence: RecurrenceResource, epoch: string) {
  return {
    database_epoch: epoch,
    expected_revision: recurrence.task_revision,
    expected_config_revision: recurrence.config_revision,
    expected_settings_revision: recurrence.settings_revision,
  };
}
export function completionPayload(fields: OccurrenceFields, timezone: string) {
  if (fields.selected.length === 0) throw new Error('Выберите повторения для выполнения.');
  return {
    occurrences: fields.selected.map((item) => {
      const actual = resolveLocalDeadline(item, timezone);
      return {
        id: item.id,
        expected_revision: item.revision,
        ...(actual === null ? {} : { actual_completed_at: actual }),
      };
    }),
  };
}
export function cancellationAllowed(selected: SelectedOccurrence[], category: string, now: string) {
  return (
    category === 'paused' &&
    selected.length > 0 &&
    selected.every(
      (item) => item.state === 'pending' && Date.parse(item.deadline) > Date.parse(now),
    )
  );
}
export const occurrenceLabels: Record<OccurrenceResource['state'], string> = {
  pending: 'Ожидает',
  debt: 'Долг',
  missed: 'Пропущено',
  completed: 'Выполнено',
  completed_late: 'Записано после окна',
  cancelled: 'Отменено',
};
export function occurrenceScheduleLabel(
  schedule: OccurrenceResource['schedule_snapshot']['schedule'],
) {
  if (schedule.mode === 'after_completion')
    return `После выполнения: каждые ${schedule.every} ${schedule.unit === 'hours' ? 'ч.' : 'сут.'}`;
  if (schedule.pattern === 'weekdays') {
    const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    return `Дни недели: ${schedule.weekdays.map((day) => days[day - 1]).join(', ')}; время ${shortLocalTime(schedule.local_time)}`;
  }
  if (schedule.pattern === 'months')
    return `Каждые ${schedule.every} мес., день ${schedule.day_of_month}; время ${shortLocalTime(schedule.local_time)}`;
  return `Каждые ${schedule.every} ${schedule.pattern === 'days' ? 'сут.' : 'нед.'}; время ${shortLocalTime(schedule.local_time)}`;
}

/** «08:00:00.000» → «08:00»; seconds stay only when they are not zero. */
export function shortLocalTime(time: string): string {
  const match = /^(\d{2}:\d{2})(?::(\d{2}))?(?:\.(\d+))?$/u.exec(time);
  if (!match) return time;
  const [, minutes = time, seconds = '00', fraction = ''] = match;
  if (/^0*$/u.test(fraction)) return seconds === '00' ? minutes : `${minutes}:${seconds}`;
  return `${minutes}:${seconds}.${fraction}`;
}
/**
 * A moment in the given time zone, to the minute unless it carries seconds or milliseconds.
 * An instant or zone the browser cannot format is shown as stored, never breaking the screen.
 */
export function occurrenceMoment(instant: string, timezone: string): string {
  const date = new Date(instant);
  const seconds = date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0;
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(seconds ? { second: '2-digit' } : {}),
      ...(date.getUTCMilliseconds() !== 0 ? { fractionalSecondDigits: 3 } : {}),
    }).format(date);
  } catch {
    return instant;
  }
}
/** The confirmation window in days, hours and minutes instead of milliseconds. */
export function windowLabel(ms: number): string {
  if (ms === 0) return 'нет';
  if (ms < 0 || !Number.isFinite(ms)) return `${String(ms)} мс`;
  const minutes = ms / 60000;
  if (!Number.isInteger(minutes)) return `${String(ms / 1000)} с`;
  const parts = [
    [Math.floor(minutes / 1440), 'сут.'],
    [Math.floor((minutes % 1440) / 60), 'ч'],
    [minutes % 60, 'мин'],
  ] as const;
  return parts
    .filter(([count]) => count > 0)
    .map(([count, unit]) => `${String(count)} ${unit}`)
    .join(' ');
}
