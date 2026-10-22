import { z } from 'zod/mini';
import type { settingsEnvelopeSchema } from '../../../src/schema/settings.js';
import type { DraftBase } from '../data/drafts.js';
import type { ProjectResource } from '../../../src/schema/projects.js';
export const settingsFieldsSchema = z.strictObject({
  project_slug: z.string(),
  timezone: z.string(),
});
export type SettingsFields = z.infer<typeof settingsFieldsSchema>;
export type SettingsPage = {
  settings: z.infer<typeof settingsEnvelopeSchema>;
  project?: ProjectResource;
};
export function settingsBase(page: SettingsPage) {
  return {
    database_epoch: page.settings.data.database_epoch,
    expected_settings_revision: page.settings.data.revision,
    ...(page.project ? { expected_config_revision: page.project.config_revision } : {}),
  };
}
/** Attribution changes its project guard, never the original global settings base. */
export function settingsAttributionBase(base: DraftBase, project: ProjectResource) {
  return { ...base, expected_config_revision: project.config_revision };
}
