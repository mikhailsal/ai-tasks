import { configurationDraft } from '../components/configuration-model.js';
import {
  readConfiguration,
  readProject,
  collectProjectTasks,
  readSettings,
} from '../data/resources.js';
import type { ConfigurationFields } from './configuration-fields.js';
export {
  configurationFieldsSchema,
  migrationInput,
  priorityKey,
  type ConfigurationFields,
} from './configuration-fields.js';
export async function loadConfigurationPage(slug: string) {
  const [project, config, tasks, settings] = await Promise.all([
    readProject(slug),
    readConfiguration(slug),
    collectProjectTasks(slug),
    readSettings(slug),
  ]);
  if (
    project.meta.database_epoch !== config.meta.database_epoch ||
    project.meta.database_epoch !== settings.meta.database_epoch ||
    project.data.config_revision !== config.data.revision
  )
    throw new Error('Настройки изменились при загрузке. Повторите загрузку.');
  return { project, config, tasks, settings };
}
export type ConfigurationPage = Awaited<ReturnType<typeof loadConfigurationPage>>;
export function configurationBase(page: ConfigurationPage) {
  return {
    database_epoch: page.config.meta.database_epoch,
    expected_revision: page.config.data.revision,
    expected_config_revision: page.config.data.revision,
    expected_settings_revision: page.settings.data.revision,
  };
}
export function initialConfigurationFields(page: ConfigurationPage): ConfigurationFields {
  return {
    config: configurationDraft(page.config.data),
    status_mappings: [],
    priority_mappings: [],
    affected_tasks: [],
  };
}
