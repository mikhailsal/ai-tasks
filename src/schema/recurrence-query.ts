import * as z from 'zod/mini';
import { successEnvelopeSchema } from './envelopes.js';
import { confirmationWindowSchema, missPolicySchema, scheduleSchema } from './recurrence-input.js';
import {
  configKeySchema,
  descriptionSchema,
  revisionSchema,
  slugSchema,
  timestampSchema,
  timezoneSchema,
  uuidSchema,
} from './values.js';
export const occurrenceStateSchema = z.enum([
  'pending',
  'completed',
  'completed_late',
  'debt',
  'missed',
  'cancelled',
]);
export const recurrenceConfigurationSchema = z.strictObject({
  generation_id: uuidSchema,
  generation_number: revisionSchema,
  first_deadline: timestampSchema,
  schedule: scheduleSchema,
  timezone: timezoneSchema,
  miss_policy: missPolicySchema,
  confirmation_window_ms: confirmationWindowSchema,
});
export const occurrenceResourceSchema = z.strictObject({
  id: uuidSchema,
  task_id: uuidSchema,
  project_slug: slugSchema,
  generation_id: uuidSchema,
  occurrence_key: z.string().check(z.minLength(1)),
  deadline: timestampSchema,
  expires_at: timestampSchema,
  state: occurrenceStateSchema,
  revision: revisionSchema,
  description_snapshot: descriptionSchema,
  rendered_html_snapshot: z.string(),
  render_policy_version: revisionSchema,
  schedule_snapshot: recurrenceConfigurationSchema,
  miss_policy: missPolicySchema,
  confirmation_window_ms: confirmationWindowSchema,
  actual_completed_at: z.nullable(timestampSchema),
  completion_recorded_at: z.nullable(timestampSchema),
  missed_at: z.nullable(timestampSchema),
  cancelled_at: z.nullable(timestampSchema),
  cancel_reason: z.nullable(z.string()),
  created_at: timestampSchema,
});
export const occurrenceListInputSchema = z.strictObject({
  state: z.optional(occurrenceStateSchema),
  limit: z._default(z.int().check(z.minimum(1)).check(z.maximum(200)), 50),
  cursor: z.optional(z.string().check(z.minLength(1)).check(z.maxLength(4096))),
});
const countSchema = z.int().check(z.nonnegative());
export const occurrenceCountsSchema = z.strictObject({
  pending: countSchema,
  debt: countSchema,
  missed: countSchema,
  completed: countSchema,
  completed_late: countSchema,
  cancelled: countSchema,
  total: countSchema,
});
export const recurrenceResourceSchema = z.strictObject({
  task_id: uuidSchema,
  project_slug: slugSchema,
  task_revision: revisionSchema,
  config_revision: revisionSchema,
  settings_revision: revisionSchema,
  status_id: configKeySchema,
  category: z.enum(['draft', 'active', 'paused', 'archived']),
  archived_at: z.nullable(timestampSchema),
  display_deadline: z.nullable(timestampSchema),
  configuration: recurrenceConfigurationSchema,
  checkpoint: z.strictObject({
    revision: revisionSchema,
    cursor_anchor: z.nullable(timestampSchema),
    next_candidate_at: z.nullable(timestampSchema),
    waiting_predecessor_id: z.nullable(uuidSchema),
  }),
  occurrences: occurrenceCountsSchema,
});
export const recurrenceEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: recurrenceResourceSchema,
});
export const occurrenceEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: occurrenceResourceSchema,
});
export const occurrencePageEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({
    items: z.array(occurrenceResourceSchema),
    next_cursor: z.nullable(z.string()),
  }),
});
export type RecurrenceResource = z.infer<typeof recurrenceResourceSchema>;
export type OccurrenceResource = z.infer<typeof occurrenceResourceSchema>;
export type OccurrenceListInput = z.input<typeof occurrenceListInputSchema>;
