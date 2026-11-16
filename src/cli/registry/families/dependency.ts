import { mutationOptions, readOptions } from '../option-sets.js';
import type { CommandDescriptor } from '../types.js';

const taskId = { name: 'task-id', description: 'Dependent ordinary task ID' };
const firstTask = { command: 'task list', path: 'data.items[0].id' };
const secondTask = { command: 'task list', path: 'data.items[1].id' };
const tokens = {
  operation_id: '{{new_uuid}}',
  database_epoch: '{{database_epoch}}',
  expected_revision: '{{task_revision}}',
  expected_config_revision: '{{config_revision}}',
  prerequisite_task_id: '{{prerequisite_id}}',
  prerequisite_project_slug: 'demo',
};
const placeholders = {
  new_uuid: { generate: 'uuid' },
  database_epoch: { command: 'meta', path: 'meta.database_epoch' },
  task_revision: { command: 'task get', path: 'data.revision' },
  config_revision: { command: 'config get', path: 'data.revision' },
  task_id: firstTask,
  prerequisite_id: secondTask,
} as const;
const twoTasks = {
  fixture: 'two_ordinary_tasks',
  fixture_note: 'project demo with two ordinary tasks and no links',
} as const;
const linkedTasks = {
  fixture: 'linked_tasks',
  fixture_note: 'project demo with two ordinary tasks, the first listed depending on the second',
} as const;
const mutationInput = async () =>
  (await import('../../../core/tasks/dependencies.js')).dependencyMutationSchema;

export const dependencyCommands: CommandDescriptor[] = [
  {
    path: ['dependency', 'list'],
    purpose: 'Read the prerequisite links of an ordinary task and whether each is satisfied.',
    kind: 'read',
    scope: 'project',
    positional: [taskId],
    options: readOptions,
    example: {
      argv: ['dependency', 'list', '{{task_id}}', '--project', 'demo', '--json'],
      placeholders: { task_id: firstTask },
      fixture: 'ordinary_task',
      fixture_note: "project demo with one ordinary task 'Example task' in the initial status",
    },
  },
  {
    path: ['dependency', 'add'],
    purpose: 'Make another ordinary task a prerequisite of this task.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: mutationInput,
    mutation: 'dependency.add',
    example: {
      argv: ['dependency', 'add', '{{task_id}}', '--project', 'demo', '--input', '-', '--json'],
      input: tokens,
      placeholders,
      ...twoTasks,
    },
  },
  {
    path: ['dependency', 'remove'],
    purpose: 'Remove a prerequisite link from this task.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: mutationInput,
    mutation: 'dependency.remove',
    example: {
      argv: ['dependency', 'remove', '{{task_id}}', '--project', 'demo', '--input', '-', '--json'],
      input: tokens,
      placeholders,
      ...linkedTasks,
    },
  },
];
