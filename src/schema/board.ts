import * as z from 'zod/mini';
import { taskListInputSchema } from './task-query.js';
import { taskTransitionSchema, taskResourceSchema } from './tasks.js';
import { successEnvelopeSchema } from './envelopes.js';
import { configKeySchema, revisionSchema, slugSchema, uuidSchema } from './values.js';
export const boardColumnInputSchema = z.strictObject({
  ...taskListInputSchema.shape,
  project_slug: slugSchema,
  kind: z.enum(['ordinary', 'recurring']),
  status_id: configKeySchema,
  limit: z._default(z.int().check(z.minimum(1)).check(z.maximum(200)), 50),
  cursor: z.optional(z.string().check(z.minLength(1)).check(z.maxLength(4096))),
});
export const boardMoveSchema = z.extend(taskTransitionSchema, {
  before_task_id: z.nullable(uuidSchema),
  expected_source_order_revision: revisionSchema,
  expected_destination_order_revision: revisionSchema,
});
export const boardColumnEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({
    items: z.array(taskResourceSchema),
    next_cursor: z.nullable(z.string()),
    order_revision: revisionSchema,
  }),
});
