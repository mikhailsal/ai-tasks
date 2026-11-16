import * as z from 'zod/mini';
import { slugSchema, timestampSchema } from './values.js';

/** Spec 011: worker liveness as reads show it. Browser safe. */
export const workerStatusSchema = z.enum(['healthy', 'stale', 'never']);
export const workerViewSchema = z.strictObject({
  status: workerStatusSchema,
  last_pass_at: z.exactOptional(timestampSchema),
});
export const metaWorkerSchema = z.strictObject({
  project_slug: slugSchema,
  status: workerStatusSchema,
  last_pass_at: z.exactOptional(timestampSchema),
  tolerance_seconds: z.int().check(z.positive()),
});
export type WorkerView = z.infer<typeof workerViewSchema>;
