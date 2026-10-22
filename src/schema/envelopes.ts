import { z } from 'zod/mini';
import {
  jsonValueSchema,
  revisionSchema,
  timestampSchema,
  timezoneSchema,
  uuidSchema,
} from './values.js';
export const mutationEnvelopeSchema = z.strictObject({
  operation_id: uuidSchema,
  database_epoch: uuidSchema,
  expected_revision: z.optional(revisionSchema),
  expected_config_revision: z.optional(revisionSchema),
  expected_settings_revision: z.optional(revisionSchema),
  payload: jsonValueSchema,
});
export const responseMetaSchema = z.strictObject({
  database_epoch: uuidSchema,
  timezone: timezoneSchema,
  now: timestampSchema,
  operation_id: z.optional(uuidSchema),
  audit_ids: z.optional(z.array(uuidSchema)),
  read_revision: z.optional(revisionSchema),
  as_of: z.optional(timestampSchema),
});
export const successEnvelopeSchema = z.strictObject({
  ok: z.literal(true),
  data: jsonValueSchema,
  meta: responseMetaSchema,
});
export const mutationSuccessEnvelopeSchema = z.extend(successEnvelopeSchema, {
  meta: z.extend(responseMetaSchema, {
    operation_id: uuidSchema,
    audit_ids: z.array(uuidSchema),
  }),
});
// T015 supplies the semantic error-code registry; this contract stays browser safe.
export const errorEnvelopeSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.string().check(z.minLength(1)),
    message: z.string(),
    details: jsonValueSchema,
    retryable: z.boolean(),
  }),
});
export const responseEnvelopeSchema = z.discriminatedUnion('ok', [
  successEnvelopeSchema,
  errorEnvelopeSchema,
]);
export type MutationEnvelope = z.infer<typeof mutationEnvelopeSchema>;
export type ResponseMeta = z.infer<typeof responseMetaSchema>;
export type SuccessEnvelope = z.infer<typeof successEnvelopeSchema>;
export type MutationSuccessEnvelope = z.infer<typeof mutationSuccessEnvelopeSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof responseEnvelopeSchema>;
