import * as z from 'zod/mini';
import { slugSchema } from './values.js';
export const readScopeSchema = z.union([
  z.strictObject({ project_slug: slugSchema }),
  z.strictObject({ all_projects: z.literal(true) }),
]);
export type ReadScope = z.infer<typeof readScopeSchema>;
