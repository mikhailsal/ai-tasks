import * as z from 'zod/mini';
import { recurrenceInputSchema } from './recurrence-input.js';
import {
  ordinaryCategorySchema,
  priorityValueSchema,
  recurringCategorySchema,
} from './configuration.js';
import {
  descriptionSchema,
  configKeySchema,
  jsonValueSchema,
  revisionSchema,
  slugSchema,
  timestampSchema,
  titleSchema,
  uuidSchema,
} from './values.js';
export const confirmationSchema = z.strictObject({
  asserted: z.literal(true),
  user_text: z
    .string()
    .check(z.refine((text) => text.trim().length > 0, 'Confirmation text is required')),
});
const taskCreateFields = {
  title: titleSchema,
  description: z.optional(descriptionSchema),
  emoji: z.optional(z.string()),
  status_id: z.optional(configKeySchema),
  priority: z.optional(priorityValueSchema),
};
export const taskCreateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ordinary'),
    ...taskCreateFields,
    deadline: z.optional(z.nullable(timestampSchema)),
  }),
  z.strictObject({
    kind: z.literal('recurring'),
    ...taskCreateFields,
    recurrence: recurrenceInputSchema,
  }),
]);
export const taskPatchSchema = z
  .strictObject({
    title: z.optional(titleSchema),
    description: z.optional(descriptionSchema),
    emoji: z.optional(z.string()),
    priority: z.optional(priorityValueSchema),
    deadline: z.optional(z.nullable(timestampSchema)),
  })
  .check(z.refine((value) => Object.keys(value).length > 0, 'At least one task field is required'));
const returnMarkerFields = {
  replacement_emoji: z.optional(z.string()),
  emoji_collision: z.optional(z.enum(['reject', 'use_default'])),
};
export const taskTransitionSchema = z.strictObject({
  to_status_id: configKeySchema,
  confirmation: z.optional(jsonValueSchema),
  ...returnMarkerFields,
});
export const taskRestoreSchema = z.strictObject({
  confirmation: z.optional(jsonValueSchema),
  ...returnMarkerFields,
});
export const taskArchiveSchema = z.strictObject({ confirmation: z.optional(jsonValueSchema) });
export const taskCategorySchema = z.union([ordinaryCategorySchema, recurringCategorySchema]);
export const taskResourceSchema = z.strictObject({
  id: uuidSchema,
  project_slug: slugSchema,
  kind: z.enum(['ordinary', 'recurring']),
  title: titleSchema,
  description: descriptionSchema,
  emoji: z.string(),
  status_id: configKeySchema,
  category: taskCategorySchema,
  priority: priorityValueSchema,
  deadline: z.nullable(timestampSchema),
  display_deadline: z.nullable(timestampSchema),
  blocked: z.optional(z.boolean()),
  archived_at: z.nullable(timestampSchema),
  revision: revisionSchema,
  config_revision: revisionSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export const dependencyResourceSchema = z.strictObject({
  task_id: uuidSchema,
  prerequisite_task_id: uuidSchema,
  prerequisite_project_slug: slugSchema,
  satisfied: z.boolean(),
});
export const taskDetailSchema = z.extend(taskResourceSchema, {
  rendered_html: z.string(),
  dependencies: z.array(dependencyResourceSchema),
  blocked: z.boolean(),
  recurrence: z.nullable(jsonValueSchema),
});
export type TaskResource = z.infer<typeof taskResourceSchema>;
export type TaskDetail = z.infer<typeof taskDetailSchema>;
