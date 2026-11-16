import * as z from 'zod/mini';
import { hintSchema } from './diagnostics.js';

/** Spec 010: a short, non-fatal note on a successful response. Browser safe. */
export const MAX_ADVISORIES = 10;
export const advisoryCodeSchema = z.string().check(z.regex(/^[a-z][a-z0-9_]{2,47}$/u));
export const advisorySubjectSchema = z.strictObject({
  type: z.enum(['task', 'project']),
  id: z.string().check(z.minLength(1)),
});
export const advisorySchema = z.strictObject({
  code: advisoryCodeSchema,
  message: z.string().check(z.minLength(1), z.maxLength(160)),
  remedy: hintSchema,
  subject: z.exactOptional(advisorySubjectSchema),
  count: z.exactOptional(z.int().check(z.minimum(2))),
});
/** Envelope keys; both are absent when nothing applies, so such responses are unchanged. */
export const advisoryEnvelopeFields = {
  advisories: z.exactOptional(z.array(advisorySchema).check(z.maxLength(MAX_ADVISORIES))),
  advisories_omitted: z.exactOptional(z.int().check(z.minimum(1))),
};
export type Advisory = z.infer<typeof advisorySchema>;
export type AdvisorySubject = z.infer<typeof advisorySubjectSchema>;
