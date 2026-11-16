import { mutationOptions, readOptions } from '../option-sets.js';
import type { CommandDescriptor } from '../types.js';

const fixture = {
  fixture: 'empty_project',
  fixture_note: 'a migrated database with the project demo',
} as const;

export const settingsCommands: CommandDescriptor[] = [
  {
    path: ['settings', 'get'],
    purpose: 'Read global settings, including the timezone and the settings revision.',
    kind: 'read',
    scope: 'either',
    options: readOptions,
    example: {
      argv: ['settings', 'get', '--project', 'demo', '--json'],
      placeholders: {},
      ...fixture,
    },
  },
  {
    path: ['settings', 'update'],
    purpose: 'Change the global timezone under the settings and configuration revision guards.',
    kind: 'mutation',
    scope: 'project',
    options: mutationOptions,
    input: async () => (await import('../../../schema/settings.js')).settingsInputSchema,
    mutation: 'settings.update',
    example: {
      argv: ['settings', 'update', '--project', 'demo', '--input', '-', '--json'],
      input: {
        operation_id: '{{new_uuid}}',
        database_epoch: '{{database_epoch}}',
        expected_settings_revision: '{{settings_revision}}',
        expected_config_revision: '{{config_revision}}',
        timezone: 'Europe/Berlin',
      },
      placeholders: {
        new_uuid: { generate: 'uuid' },
        database_epoch: { command: 'meta', path: 'meta.database_epoch' },
        settings_revision: { command: 'settings get', path: 'data.revision' },
        config_revision: { command: 'config get', path: 'data.revision' },
      },
      ...fixture,
    },
  },
];
