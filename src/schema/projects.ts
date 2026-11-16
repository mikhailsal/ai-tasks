import * as z from 'zod/mini';
import { projectConfigInputSchema } from './configuration.js';
import {
  descriptionSchema,
  nameSchema,
  revisionSchema,
  slugSchema,
  timestampSchema,
  uuidSchema,
} from './values.js';
import { workerViewSchema } from './worker-status.js';
export const projectPrioritySchema = z
  .int()
  .check(z.minimum(-2147483648))
  .check(z.maximum(2147483647));
export const projectCreateSchema = z.strictObject({
  slug: slugSchema,
  name: nameSchema,
  emoji: z.string(),
  description: z.optional(descriptionSchema),
  priority: z.optional(projectPrioritySchema),
  config: z.optional(projectConfigInputSchema),
});
export const dayStartHourSchema = z.int().check(z.minimum(0)).check(z.maximum(23));
export const projectPatchSchema = z
  .strictObject({
    name: z.optional(nameSchema),
    description: z.optional(descriptionSchema),
    emoji: z.optional(z.string()),
    priority: z.optional(projectPrioritySchema),
    // Spec 008: local hour at which the project's day begins.
    day_start_hour: z.optional(dayStartHourSchema),
  })
  .check(
    z.refine((input) => Object.keys(input).length > 0, 'At least one project field is required'),
  );
export const affectedTasksSchema = z.array(
  z.strictObject({ task_id: uuidSchema, expected_revision: revisionSchema }),
);
export const projectLifecycleSchema = z.strictObject({ affected_tasks: affectedTasksSchema });
export const projectResourceSchema = z.strictObject({
  slug: slugSchema,
  name: nameSchema,
  description: descriptionSchema,
  emoji: z.string(),
  priority: projectPrioritySchema,
  archived_at: z.nullable(timestampSchema),
  revision: revisionSchema,
  config_revision: revisionSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  day_start_hour: z.exactOptional(dayStartHourSchema),
  // Spec 011: present on project reads, absent in mutation results and audit snapshots.
  worker: z.exactOptional(workerViewSchema),
});
export type ProjectResource = z.infer<typeof projectResourceSchema>;
