import { mutationOptions, pageOptions, readOptions } from '../option-sets.js';
import type { CommandDescriptor } from '../types.js';

const taskId = { name: 'task-id', description: 'Task ID' };
const filterOptions = [
  'q',
  'status',
  'category',
  'kind',
  'emoji',
  'archive',
  'includeTerminal',
  'deadlinePreset',
  'deadlineDay',
] as const;
const firstTask = { command: 'task list', path: 'data.items[0].id' };
const tokens = {
  operation_id: '{{new_uuid}}',
  database_epoch: '{{database_epoch}}',
  expected_revision: '{{task_revision}}',
  expected_config_revision: '{{config_revision}}',
};
const tokenSources = {
  new_uuid: { generate: 'uuid' },
  database_epoch: { command: 'meta', path: 'meta.database_epoch' },
  task_revision: { command: 'task get', path: 'data.revision' },
  config_revision: { command: 'config get', path: 'data.revision' },
  task_id: firstTask,
} as const;
const empty = {
  fixture: 'empty_project',
  fixture_note: 'a migrated database with project demo and its default configuration, no tasks',
} as const;
const ordinary = {
  fixture: 'ordinary_task',
  fixture_note: "project demo with one ordinary task 'Example task' in the initial status idea",
} as const;
const schemas = async () => import('../../../schema/tasks.js');

export const taskCommands: CommandDescriptor[] = [
  {
    path: ['task', 'board'],
    purpose: 'Read one board column of one status and kind in shared manual order.',
    kind: 'read',
    scope: 'project',
    options: [...readOptions, ...pageOptions, ...filterOptions],
    input: async () => (await import('../../../schema/board.js')).boardColumnInputSchema,
    example: {
      argv: [
        'task',
        'board',
        '--project',
        'demo',
        '--kind',
        'ordinary',
        '--status',
        'idea',
        '--json',
      ],
      placeholders: {},
      ...ordinary,
    },
  },
  {
    path: ['task', 'list'],
    purpose: 'List tasks in an explicit scope with filters and paging.',
    kind: 'read',
    scope: 'either',
    options: [...readOptions, ...pageOptions, ...filterOptions],
    input: async () => (await import('../../../schema/task-query.js')).taskListInputSchema,
    example: {
      argv: ['task', 'list', '--project', 'demo', '--json'],
      placeholders: {},
      ...ordinary,
    },
  },
  {
    path: ['task', 'position'],
    purpose: 'Move a task to an explicitly guarded position in its board column.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: async () => (await import('../../../schema/board.js')).boardMoveSchema,
    mutation: 'task.position',
    example: {
      argv: ['task', 'position', '{{task_id}}', '--project', 'demo', '--input', '-', '--json'],
      input: {
        ...tokens,
        to_status_id: 'idea',
        before_task_id: null,
        expected_source_order_revision: '{{order_revision}}',
        expected_destination_order_revision: '{{order_revision}}',
      },
      placeholders: {
        ...tokenSources,
        order_revision: {
          command: 'task board --kind ordinary --status idea',
          path: 'data.order_revision',
        },
      },
      ...ordinary,
    },
  },
  {
    path: ['task', 'get'],
    purpose: 'Read one task with its saved description and current revision.',
    kind: 'read',
    scope: 'project',
    positional: [taskId],
    options: readOptions,
    example: {
      argv: ['task', 'get', '{{task_id}}', '--project', 'demo', '--json'],
      placeholders: { task_id: firstTask },
      ...ordinary,
    },
  },
  {
    path: ['task', 'create'],
    purpose: 'Create an ordinary or recurring task in the selected project.',
    kind: 'mutation',
    scope: 'project',
    options: mutationOptions,
    input: async () => (await schemas()).taskCreateSchema,
    mutation: 'task.create',
    example: {
      argv: ['task', 'create', '--project', 'demo', '--input', '-', '--json'],
      input: {
        operation_id: tokens.operation_id,
        database_epoch: tokens.database_epoch,
        expected_config_revision: tokens.expected_config_revision,
        kind: 'ordinary',
        title: 'Write the report',
      },
      placeholders: {
        new_uuid: tokenSources.new_uuid,
        database_epoch: tokenSources.database_epoch,
        config_revision: tokenSources.config_revision,
      },
      ...empty,
    },
  },
  {
    path: ['task', 'update'],
    purpose: 'Change the title, description, emoji, priority or deadline of a task.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: async () => (await schemas()).taskPatchSchema,
    mutation: 'task.update',
    example: {
      argv: ['task', 'update', '{{task_id}}', '--project', 'demo', '--input', '-', '--json'],
      input: { ...tokens, title: 'Updated title' },
      placeholders: tokenSources,
      ...ordinary,
    },
  },
  {
    path: ['task', 'transition'],
    purpose: 'Move a task to another status allowed by the project workflow.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: async () => (await schemas()).taskTransitionSchema,
    mutation: 'task.transition',
    example: {
      argv: ['task', 'transition', '{{task_id}}', '--project', 'demo', '--input', '-', '--json'],
      input: { ...tokens, to_status_id: 'planning' },
      placeholders: tokenSources,
      ...ordinary,
    },
  },
  {
    path: ['task', 'archive'],
    purpose: 'Archive a task, keeping it readable through archive filters.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: async () => (await schemas()).taskArchiveSchema,
    mutation: 'task.archive',
    example: {
      argv: ['task', 'archive', '{{task_id}}', '--project', 'demo', '--input', '-', '--json'],
      input: tokens,
      placeholders: tokenSources,
      ...ordinary,
    },
  },
  {
    path: ['task', 'restore'],
    purpose: 'Restore an archived task to its active state.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: async () => (await schemas()).taskRestoreSchema,
    mutation: 'task.restore',
    example: {
      argv: ['task', 'restore', '{{task_id}}', '--project', 'demo', '--input', '-', '--json'],
      input: tokens,
      placeholders: {
        ...tokenSources,
        task_id: { command: 'task list --archive only', path: 'data.items[0].id' },
      },
      fixture: 'archived_task',
      fixture_note: "project demo with one archived ordinary task 'Example task'",
    },
  },
];
