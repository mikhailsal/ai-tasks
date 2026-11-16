import { mutationOptions, pageOptions, readOptions } from '../option-sets.js';
import type { CommandDescriptor } from '../types.js';

const tokens = {
  operation_id: '{{new_uuid}}',
  database_epoch: '{{database_epoch}}',
  expected_revision: '{{project_revision}}',
  expected_config_revision: '{{config_revision}}',
};
const tokenSources = {
  new_uuid: { generate: 'uuid' },
  database_epoch: { command: 'meta', path: 'meta.database_epoch' },
  project_revision: { command: 'project get', path: 'data.revision' },
  config_revision: { command: 'config get', path: 'data.revision' },
} as const;
const lifecycleSchema = async () =>
  (await import('../../../schema/projects.js')).projectLifecycleSchema;
const emptyProject = {
  fixture: 'empty_project',
  fixture_note: 'a migrated database with project demo and its default configuration, no tasks',
} as const;

export const projectCommands: CommandDescriptor[] = [
  {
    path: ['project', 'list'],
    purpose: 'List projects in an explicit scope, with archive and paging filters.',
    kind: 'read',
    scope: 'either',
    options: [...readOptions, ...pageOptions, 'archive'],
    input: async () => (await import('../../../core/queries/projects.js')).projectListInputSchema,
    example: {
      argv: ['project', 'list', '--all-projects', '--json'],
      placeholders: {},
      ...emptyProject,
    },
  },
  {
    path: ['project', 'get'],
    purpose: 'Read the selected project with its current revision.',
    kind: 'read',
    scope: 'project',
    options: readOptions,
    example: {
      argv: ['project', 'get', '--project', 'demo', '--json'],
      placeholders: {},
      ...emptyProject,
    },
  },
  {
    path: ['project', 'create'],
    purpose: 'Create a project with a default or supplied configuration.',
    kind: 'mutation',
    scope: 'project',
    options: mutationOptions,
    input: async () => (await import('../../../schema/projects.js')).projectCreateSchema,
    mutation: 'project.create',
    example: {
      argv: ['project', 'create', '--project', 'second', '--input', '-', '--json'],
      input: {
        operation_id: tokens.operation_id,
        database_epoch: tokens.database_epoch,
        slug: 'second',
        name: 'Second project',
        emoji: '📦',
      },
      placeholders: {
        new_uuid: tokenSources.new_uuid,
        database_epoch: tokenSources.database_epoch,
      },
      ...emptyProject,
    },
  },
  {
    path: ['project', 'update'],
    purpose: 'Change the name, emoji, description or priority of the selected project.',
    kind: 'mutation',
    scope: 'project',
    options: mutationOptions,
    input: async () => (await import('../../../schema/projects.js')).projectPatchSchema,
    mutation: 'project.update',
    example: {
      argv: ['project', 'update', '--project', 'demo', '--input', '-', '--json'],
      input: { ...tokens, name: 'Renamed project' },
      placeholders: tokenSources,
      ...emptyProject,
    },
  },
  {
    path: ['project', 'archive'],
    purpose: 'Archive the selected project and report the tasks it affects.',
    kind: 'mutation',
    scope: 'project',
    options: mutationOptions,
    input: lifecycleSchema,
    mutation: 'project.archive',
    example: {
      argv: ['project', 'archive', '--project', 'demo', '--input', '-', '--json'],
      input: { ...tokens, affected_tasks: [] },
      placeholders: tokenSources,
      ...emptyProject,
    },
  },
  {
    path: ['project', 'restore'],
    purpose: 'Restore an archived project and report the tasks it affects.',
    kind: 'mutation',
    scope: 'project',
    options: mutationOptions,
    input: lifecycleSchema,
    mutation: 'project.restore',
    example: {
      argv: ['project', 'restore', '--project', 'demo', '--input', '-', '--json'],
      input: { ...tokens, affected_tasks: [] },
      placeholders: tokenSources,
      fixture: 'archived_project',
      fixture_note: 'project demo archived, with no tasks',
    },
  },
];
