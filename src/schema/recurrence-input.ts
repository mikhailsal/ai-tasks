import * as z from 'zod/mini';
import {
  configKeySchema,
  jsonValueSchema,
  revisionSchema,
  timestampSchema,
  uuidSchema,
} from './values.js';
export const missPolicySchema = z.enum(['carry_forward', 'record_miss']);
export const confirmationWindowSchema = z.int().check(z.minimum(0)).check(z.maximum(2592000000));
export const recurrenceEverySchema = z.int().check(z.minimum(1)).check(z.maximum(3650));
export const localTimeSchema = z
  .string()
  .check(z.regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}$/u));
export const calendarScheduleSchema = z.discriminatedUnion('pattern', [
  z.strictObject({
    mode: z.literal('calendar'),
    pattern: z.enum(['days', 'weeks']),
    every: recurrenceEverySchema,
    local_time: localTimeSchema,
  }),
  z.strictObject({
    mode: z.literal('calendar'),
    pattern: z.literal('weekdays'),
    weekdays: z
      .array(z.int().check(z.minimum(1)).check(z.maximum(7)))
      .check(z.minLength(1))
      .check(z.maxLength(7))
      .check(z.refine((days) => new Set(days).size === days.length, 'Weekdays must be distinct')),
    local_time: localTimeSchema,
  }),
  z.strictObject({
    mode: z.literal('calendar'),
    pattern: z.literal('months'),
    every: recurrenceEverySchema,
    day_of_month: z.int().check(z.minimum(1)).check(z.maximum(31)),
    local_time: localTimeSchema,
  }),
]);
export const afterCompletionScheduleSchema = z.strictObject({
  mode: z.literal('after_completion'),
  unit: z.enum(['hours', 'days']),
  every: recurrenceEverySchema,
});
export const scheduleSchema = z.union([calendarScheduleSchema, afterCompletionScheduleSchema]);
export const recurrenceInputSchema = z.strictObject({
  first_deadline: timestampSchema,
  schedule: scheduleSchema,
  miss_policy: missPolicySchema,
  confirmation_window_ms: confirmationWindowSchema,
});
const selectedOccurrenceSchema = z.strictObject({
  id: uuidSchema,
  expected_revision: revisionSchema,
});
export const selectedCompletionSchema = z.extend(selectedOccurrenceSchema, {
  actual_completed_at: z.optional(timestampSchema),
});
function distinctSelection<
  T extends {
    id: string;
  },
>(rows: T[]) {
  return new Set(rows.map((row) => row.id)).size === rows.length;
}
export const completeOccurrencesSchema = z.strictObject({
  occurrences: z
    .array(selectedCompletionSchema)
    .check(z.minLength(1))
    .check(z.refine(distinctSelection, 'Occurrence IDs must be distinct')),
});
export const cancelOccurrencesSchema = z.strictObject({
  occurrences: z
    .array(selectedOccurrenceSchema)
    .check(z.minLength(1))
    .check(z.refine(distinctSelection, 'Occurrence IDs must be distinct')),
  reason: z
    .string()
    .check(
      z.refine(
        (reason) => reason.isWellFormed() && reason.trim().length > 0,
        'A cancellation reason is required',
      ),
    ),
});
export const controlRecurrenceSchema = z.strictObject({
  to_status_id: configKeySchema,
  confirmation: z.optional(jsonValueSchema),
  first_deadline: z.optional(timestampSchema),
});
export const tickRecurrenceSchema = z.strictObject({
  tasks: z
    .array(z.strictObject({ task_id: uuidSchema, expected_revision: revisionSchema }))
    .check(z.minLength(1))
    .check(
      z.refine(
        (rows) => new Set(rows.map((row) => row.task_id)).size === rows.length,
        'Task IDs must be distinct',
      ),
    ),
});
export type CalendarSchedule = z.infer<typeof calendarScheduleSchema>;
export type AfterCompletionSchedule = z.infer<typeof afterCompletionScheduleSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type RecurrenceInput = z.infer<typeof recurrenceInputSchema>;
