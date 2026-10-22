import { z } from 'zod/mini';
import { configurationDraftSchema } from '../components/configuration-model.js';
import type { projectResourceSchema } from '../../../src/schema/projects.js';
export const projectFieldsSchema = z.strictObject({
  slug: z.string(),
  name: z.string(),
  emoji: z.string(),
  description: z.string(),
  priority: z.string(),
  preset: z.string(),
  config: z._default(z.nullable(configurationDraftSchema), null),
});
export type ProjectFields = z.infer<typeof projectFieldsSchema>;
export function projectFields(project?: z.infer<typeof projectResourceSchema>): ProjectFields {
  return {
    slug: project?.slug ?? '',
    name: project?.name ?? '',
    emoji: project?.emoji ?? '',
    description: project?.description ?? '',
    priority: String(project?.priority ?? 0),
    preset: 'classic',
    config: null,
  };
}
export { modelLabels as presetLabels } from '../components/configuration-model.js';
