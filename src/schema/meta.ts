import * as z from 'zod/mini';
import { successEnvelopeSchema } from './envelopes.js';
import { revisionSchema, timezoneSchema, uuidSchema } from './values.js';
import { metaWorkerSchema } from './worker-status.js';
export const metaDataSchema = z.strictObject({
  database_epoch: uuidSchema,
  timezone: timezoneSchema,
  settings_revision: revisionSchema,
  contract_version: z.literal(1),
  schema_version: z.literal(1),
  maintenance: z.literal(false),
  // Spec 011: one entry per active project. Always sent; optional so that responses cached
  // before the upgrade still parse.
  workers: z.exactOptional(z.array(metaWorkerSchema)),
});
export const metaEnvelopeSchema = z.extend(successEnvelopeSchema, { data: metaDataSchema });
export type MetaData = z.infer<typeof metaDataSchema>;
export type MetaEnvelope = z.infer<typeof metaEnvelopeSchema>;
