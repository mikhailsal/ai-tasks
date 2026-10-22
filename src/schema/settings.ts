import { z } from 'zod/mini';
import { successEnvelopeSchema } from './envelopes.js';
import { revisionSchema, timezoneSchema, uuidSchema } from './values.js';
export const settingsInputSchema = z.strictObject({ timezone: timezoneSchema });
export const settingsResourceSchema = z.extend(settingsInputSchema, {
  revision: revisionSchema,
  database_epoch: uuidSchema,
});
export const settingsEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: settingsResourceSchema,
});
