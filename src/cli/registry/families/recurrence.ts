import { mutationOptions, readOptions } from '../option-sets.js';
import type { CommandDescriptor } from '../types.js';

const taskId = { name: 'task-id', description: 'Recurring parent task ID' };
const parentFromList = { command: 'task list', path: 'data.items[kind=recurring].id' };
const fixture = {
  fixture: 'active_recurring_task',
  fixture_note: 'an active recurring task with a pending occurrence',
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
  config_revision: { command: 'config get', path: 'data.revision' },
  settings_revision: { command: 'settings get', path: 'data.revision' },
} as const;
const taskSources = {
  ...tokenSources,
  task_revision: { command: 'task get', path: 'data.revision' },
  task_id: parentFromList,
} as const;

export const recurrenceCommands: CommandDescriptor[] = [
  {
    path: ['recurrence', 'get'],
    purpose:
      'Read recurrence configuration, lifecycle, deadline and open counts of a recurring task.',
    kind: 'read',
    scope: 'project',
    positional: [taskId],
    options: readOptions,
    example: {
      argv: ['recurrence', 'get', '{{task_id}}', '--project', 'demo', '--json'],
      placeholders: { task_id: parentFromList },
      ...fixture,
    },
  },
  {
    path: ['recurrence', 'configure'],
    purpose: 'Replace the schedule, first deadline, miss policy and window of a recurring task.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: async () => (await import('../../../schema/recurrence-input.js')).recurrenceInputSchema,
    mutation: 'recurrence.configure',
    example: {
      argv: [
        'recurrence',
        'configure',
        '{{task_id}}',
        '--project',
        'demo',
        '--input',
        '-',
        '--json',
      ],
      input: {
        ...tokens,
        expected_revision: '{{task_revision}}',
        first_deadline: '2030-01-01T09:00:00.000Z',
        schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '09:00:00.000' },
        miss_policy: 'carry_forward',
        confirmation_window_ms: 0,
      },
      placeholders: taskSources,
      ...fixture,
    },
  },
  {
    path: ['recurrence', 'control'],
    purpose: 'Move a recurring task to another workflow status, such as pause or resume.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: async () =>
      (await import('../../../schema/recurrence-input.js')).controlRecurrenceSchema,
    mutation: 'recurrence.control',
    example: {
      argv: ['recurrence', 'control', '{{task_id}}', '--project', 'demo', '--input', '-', '--json'],
      input: { ...tokens, expected_revision: '{{task_revision}}', to_status_id: 'paused' },
      placeholders: taskSources,
      ...fixture,
    },
  },
  {
    path: ['recurrence', 'tick'],
    purpose: 'Reconcile the listed recurring tasks at their revisions using the server clock.',
    kind: 'mutation',
    scope: 'project',
    options: mutationOptions,
    input: async () => (await import('../../../schema/recurrence-input.js')).tickRecurrenceSchema,
    mutation: 'recurrence.tick',
    example: {
      argv: ['recurrence', 'tick', '--project', 'demo', '--input', '-', '--json'],
      input: {
        ...tokens,
        tasks: [{ task_id: '{{task_id}}', expected_revision: '{{task_revision}}' }],
      },
      placeholders: taskSources,
      ...fixture,
    },
  },
];
