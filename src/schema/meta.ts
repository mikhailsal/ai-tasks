import { z } from 'zod/mini';
import { successEnvelopeSchema } from './envelopes.js';
import { revisionSchema, timezoneSchema, uuidSchema } from './values.js';
export const metaDataSchema = z.strictObject({
  database_epoch: uuidSchema,
  timezone: timezoneSchema,
  settings_revision: revisionSchema,
  contract_version: z.literal(1),
  schema_version: z.literal(1),
  maintenance: z.literal(false),
});
export const metaEnvelopeSchema = z.extend(successEnvelopeSchema, { data: metaDataSchema });
export type MetaData = z.infer<typeof metaDataSchema>;
export type MetaEnvelope = z.infer<typeof metaEnvelopeSchema>;
