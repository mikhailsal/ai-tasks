import { z } from 'zod/mini';
import {
  recurrenceInputSchema,
  type RecurrenceInput,
} from '../../../src/schema/recurrence-input.js';
import type { recurrenceConfigurationSchema } from '../../../src/schema/recurrence-query.js';
import { deadlineDraft, resolveLocalDeadline } from '../data/local-time.js';
/** Draft validation preserves incomplete user input; submission uses the strict shared schema. */
export const recurrenceFieldsSchema = z.strictObject({
  first: z.strictObject({ date: z.string(), time: z.string(), offset: z.string() }),
  mode: z.enum(['calendar', 'after_completion']),
  pattern: z.enum(['days', 'weeks', 'weekdays', 'months']),
  every: z.string(),
  weekdays: z.array(z.int().check(z.minimum(1)).check(z.maximum(7))),
  dayOfMonth: z.string(),
  localTime: z.string(),
  unit: z.enum(['hours', 'days']),
  missPolicy: z.enum(['', 'carry_forward', 'record_miss']),
  confirmationWindowMs: z.string(),
});
export type RecurrenceFields = z.infer<typeof recurrenceFieldsSchema>;
export function blankRecurrenceFields(): RecurrenceFields {
  return {
    first: { date: '', time: '', offset: '' },
    mode: 'calendar',
    pattern: 'days',
    every: '1',
    weekdays: [],
    dayOfMonth: '1',
    localTime: '',
    unit: 'hours',
    missPolicy: '',
    confirmationWindowMs: '',
  };
}
export function fieldsFromRecurrence(
  configuration: z.infer<typeof recurrenceConfigurationSchema>,
  timezone: string,
): RecurrenceFields {
  const schedule = configuration.schedule;
  const fields = {
    ...blankRecurrenceFields(),
    first: deadlineDraft(configuration.first_deadline, timezone),
    mode: schedule.mode,
    missPolicy: configuration.miss_policy,
    confirmationWindowMs: String(configuration.confirmation_window_ms),
  };
  if (schedule.mode === 'after_completion')
    return { ...fields, every: String(schedule.every), unit: schedule.unit };
  return {
    ...fields,
    pattern: schedule.pattern,
    localTime: schedule.local_time,
    every: 'every' in schedule ? String(schedule.every) : '1',
    weekdays: schedule.pattern === 'weekdays' ? [...schedule.weekdays] : [],
    dayOfMonth: schedule.pattern === 'months' ? String(schedule.day_of_month) : '1',
  };
}
function integer(value: string, label: string): number {
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error(`Укажите целое число: ${label}.`);
  return Number(value);
}
export function normalizedRecurrenceTime(value: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/u.exec(value);
  if (!match) throw new Error('Укажите точное местное время повторения.');
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}.${(match[4] ?? '').padEnd(3, '0')}`;
}
/** Only a blank rule clock or one following the previous first clock follows a changed first time. */
export function changeRecurrenceFirst(
  fields: RecurrenceFields,
  first: RecurrenceFields['first'],
): RecurrenceFields {
  let followsFirst = fields.localTime === '' || fields.localTime === fields.first.time;
  if (!followsFirst && fields.first.time) {
    try {
      followsFirst =
        normalizedRecurrenceTime(fields.localTime) === normalizedRecurrenceTime(fields.first.time);
    } catch {
      // Preserve an independently edited incomplete rule clock.
    }
  }
  return { ...fields, first, localTime: followsFirst ? first.time : fields.localTime };
}
function draftSchedule(fields: RecurrenceFields) {
  if (fields.mode === 'after_completion')
    return { mode: fields.mode, unit: fields.unit, every: integer(fields.every, 'интервал') };
  const common = { mode: fields.mode, local_time: normalizedRecurrenceTime(fields.localTime) };
  if (fields.pattern === 'weekdays')
    return { ...common, pattern: fields.pattern, weekdays: fields.weekdays };
  const periodic = { ...common, pattern: fields.pattern, every: integer(fields.every, 'интервал') };
  return fields.pattern === 'months'
    ? { ...periodic, day_of_month: integer(fields.dayOfMonth, 'день месяца') }
    : periodic;
}
export function recurrencePayload(fields: RecurrenceFields, timezone: string): RecurrenceInput {
  const parsed = recurrenceFieldsSchema.parse(fields);
  const first = resolveLocalDeadline(parsed.first, timezone);
  if (!first) throw new Error('Укажите первую дату и первое время.');
  if (!parsed.missPolicy) throw new Error('Выберите правило пропуска.');
  return recurrenceInputSchema.parse({
    first_deadline: first,
    schedule: draftSchedule(parsed),
    miss_policy: parsed.missPolicy,
    confirmation_window_ms: integer(parsed.confirmationWindowMs, 'окно подтверждения'),
  });
}
