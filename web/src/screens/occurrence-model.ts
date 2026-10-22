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
  completed_late: 'Выполнено поздно',
  cancelled: 'Отменено',
};
export function occurrenceScheduleLabel(
  schedule: OccurrenceResource['schedule_snapshot']['schedule'],
) {
  if (schedule.mode === 'after_completion')
    return `После выполнения: каждые ${schedule.every} ${schedule.unit === 'hours' ? 'ч.' : 'сут.'}`;
  if (schedule.pattern === 'weekdays') {
    const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    return `Дни недели: ${schedule.weekdays.map((day) => days[day - 1]).join(', ')}; время ${schedule.local_time}`;
  }
  if (schedule.pattern === 'months')
    return `Каждые ${schedule.every} мес., день ${schedule.day_of_month}; время ${schedule.local_time}`;
  return `Каждые ${schedule.every} ${schedule.pattern === 'days' ? 'сут.' : 'нед.'}; время ${schedule.local_time}`;
}
