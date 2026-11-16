import { readOptions } from '../option-sets.js';
import type { CommandDescriptor } from '../types.js';

const operationalOptions = [
  ...readOptions,
  'operationId',
  'databaseEpoch',
  'expectedConfigRevision',
  'expectedSettingsRevision',
] as const;
const backupId = { name: 'backup-id', description: 'Managed backup ID' };
const fromList = { command: 'backup list', path: 'data.items[0].id' };
const fixture = {
  fixture: 'managed_backup',
  fixture_note: 'a migrated database with the project demo and one managed backup',
} as const;
const tokens = {
  operation_id: '{{new_uuid}}',
  database_epoch: '{{database_epoch}}',
  expected_settings_revision: '{{settings_revision}}',
  expected_config_revision: '{{config_revision}}',
};
const tokenSources = {
  new_uuid: { generate: 'uuid' },
  database_epoch: { command: 'meta', path: 'meta.database_epoch' },
  settings_revision: { command: 'settings get', path: 'data.revision' },
  config_revision: { command: 'config get', path: 'data.revision' },
} as const;
const schemas = () => import('../../../schema/recovery.js');

export const backupCommands: CommandDescriptor[] = [
  {
    path: ['backup', 'list'],
    purpose: 'List managed backups across all projects, newest first, with paging.',
    kind: 'read',
    scope: 'all_projects',
    options: [...readOptions, 'limit', 'cursor'],
    input: async () => (await schemas()).backupListInputSchema,
    example: {
      argv: ['backup', 'list', '--all-projects', '--json'],
      placeholders: {},
      ...fixture,
    },
  },
  {
    path: ['backup', 'create'],
    purpose: 'Create an online backup of the whole database under the operation guards.',
    kind: 'operational',
    scope: 'project',
    options: operationalOptions,
    input: async () => (await schemas()).backupCreateInputSchema,
    mutation: 'backup.create',
    example: {
      argv: ['backup', 'create', '--project', 'demo', '--input', '-', '--json'],
      input: tokens,
      placeholders: tokenSources,
      fixture: 'empty_project',
      fixture_note: 'a migrated database with the project demo',
    },
  },
  {
    path: ['backup', 'validate'],
    purpose: 'Validate a managed backup and list the projects a restore would affect.',
    kind: 'operational',
    scope: 'all_projects',
    positional: [backupId],
    options: readOptions,
    example: {
      argv: ['backup', 'validate', '{{backup_id}}', '--all-projects', '--json'],
      placeholders: { backup_id: fromList },
      ...fixture,
    },
  },
  {
    path: ['backup', 'restore'],
    purpose: 'Restore a managed backup and wait for the terminal job status, or pass --no-wait.',
    kind: 'operational',
    scope: 'project',
    options: [...operationalOptions, 'wait'],
    input: async () => (await schemas()).restoreInputSchema,
    mutation: 'backup.restore',
    example: {
      argv: ['backup', 'restore', '--project', 'demo', '--input', '-', '--json'],
      input: {
        ...tokens,
        backup_id: '{{backup_id}}',
        affected_projects: [
          {
            project_slug: 'demo',
            expected_revision: '{{project_revision}}',
            expected_config_revision: '{{config_revision}}',
          },
        ],
        confirmation: { asserted: true, user_text: 'Restore this backup' },
      },
      placeholders: {
        ...tokenSources,
        project_revision: { command: 'project get', path: 'data.revision' },
        backup_id: fromList,
      },
      ...fixture,
    },
  },
  {
    path: ['backup', 'status'],
    purpose: 'Read the status of a restore job by job ID or operation ID without opening SQLite.',
    kind: 'operational',
    scope: 'all_projects',
    positional: [{ name: 'job-id', description: 'Optional recovery job ID' }],
    options: [...readOptions, 'operationId'],
    input: async () => (await schemas()).recoveryStatusInputSchema,
    example: {
      argv: ['backup', 'status', '{{job_id}}', '--all-projects', '--json'],
      placeholders: { job_id: { example: 'backup restore', path: 'data.job_id' } },
      ...fixture,
    },
  },
];
