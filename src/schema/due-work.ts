import * as z from 'zod/mini';
import { successEnvelopeSchema } from './envelopes.js';
import { revisionSchema, uuidSchema } from './values.js';
export const dueWorkInputSchema = z.strictObject({
  limit: z._default(z.int().check(z.minimum(1)).check(z.maximum(128)), 128),
});
export const dueWorkEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({
    tasks: z.array(z.strictObject({ task_id: uuidSchema, expected_revision: revisionSchema })),
    expected_config_revision: revisionSchema,
    expected_settings_revision: revisionSchema,
    has_more: z.boolean(),
  }),
});
