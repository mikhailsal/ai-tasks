import { mutationOptions, readOptions } from '../option-sets.js';
import type { CommandDescriptor } from '../types.js';

const emptyProject = {
  fixture: 'empty_project',
  fixture_note: 'a migrated database with project demo and its default configuration, no tasks',
} as const;
const status = (id: string, label: string, category: string) => ({ id, label, category });
const edge = (from: string, to: string) => ({ from, to, requires_confirmation: false });
const exampleMigration = {
  config: {
    priority_model: { type: 'classic' },
    ordinary_workflow: {
      initial_status_id: 'todo',
      statuses: [status('todo', 'To do', 'not_started'), status('done', 'Done', 'completed')],
      transitions: [edge('todo', 'done'), edge('done', 'todo')],
    },
    recurring_workflow: {
      initial_status_id: 'draft',
      restore_status_id: 'paused',
      statuses: [
        status('draft', 'Draft', 'draft'),
        status('active', 'Active', 'active'),
        status('paused', 'Paused', 'paused'),
        status('archived', 'Archived', 'archived'),
      ],
      transitions: [
        edge('draft', 'active'),
        edge('active', 'paused'),
        edge('paused', 'active'),
        edge('paused', 'archived'),
        edge('archived', 'paused'),
      ],
    },
  },
  status_mappings: [],
  priority_mappings: [],
  affected_tasks: [],
};
const migrationSchema = async () =>
  (await import('../../../schema/configuration-migration.js')).configurationMigrationSchema;

export const configCommands: CommandDescriptor[] = [
  {
    path: ['config', 'get'],
    purpose: 'Read the current configuration and revision of the selected project.',
    kind: 'read',
    scope: 'project',
    options: readOptions,
    example: {
      argv: ['config', 'get', '--project', 'demo', '--json'],
      placeholders: {},
      ...emptyProject,
    },
  },
  {
    path: ['config', 'preview'],
    purpose: 'Preview configuration mappings and affected tasks without saving.',
    kind: 'read',
    scope: 'project',
    options: readOptions,
    input: migrationSchema,
    example: {
      argv: ['config', 'preview', '--project', 'demo', '--input', '-', '--json'],
      input: exampleMigration,
      placeholders: {},
      ...emptyProject,
    },
  },
  {
    path: ['config', 'migrate'],
    purpose: 'Apply a complete configuration migration with explicit mappings atomically.',
    kind: 'mutation',
    scope: 'project',
    options: mutationOptions,
    input: migrationSchema,
    mutation: 'config.migrate',
    example: {
      argv: ['config', 'migrate', '--project', 'demo', '--input', '-', '--json'],
      input: {
        operation_id: '{{new_uuid}}',
        database_epoch: '{{database_epoch}}',
        expected_revision: '{{config_revision}}',
        expected_config_revision: '{{config_revision}}',
        ...exampleMigration,
      },
      placeholders: {
        new_uuid: { generate: 'uuid' },
        database_epoch: { command: 'meta', path: 'meta.database_epoch' },
        config_revision: { command: 'config get', path: 'data.revision' },
      },
      ...emptyProject,
    },
  },
  {
    path: ['config', 'presets'],
    purpose: 'Read the built-in priority-model and workflow presets.',
    kind: 'read',
    scope: 'either',
    options: readOptions,
    example: {
      argv: ['config', 'presets', '--all-projects', '--json'],
      placeholders: {},
      ...emptyProject,
    },
  },
];
