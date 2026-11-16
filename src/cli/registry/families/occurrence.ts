import { mutationOptions, pageOptions, readOptions } from '../option-sets.js';
import type { CommandDescriptor } from '../types.js';

const taskId = { name: 'task-id', description: 'Recurring parent task ID' };
const parentFromList = { command: 'task list', path: 'data.items[kind=recurring].id' };
const occurrenceFromList = { command: 'occurrence list', path: 'data.items[0].id' };
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
  settings_revision: { command: 'settings get', path: 'data.revision' },
  task_id: parentFromList,
  occurrence_id: occurrenceFromList,
  occurrence_revision: { command: 'occurrence list', path: 'data.items[0].revision' },
} as const;

export const occurrenceCommands: CommandDescriptor[] = [
  {
    path: ['occurrence', 'list'],
    purpose: 'List frozen occurrences of one recurring task, with state and paging filters.',
    kind: 'read',
    scope: 'project',
    positional: [taskId],
    options: [...readOptions, 'state', ...pageOptions],
    input: async () =>
      (await import('../../../schema/recurrence-query.js')).occurrenceListInputSchema,
    example: {
      argv: ['occurrence', 'list', '{{task_id}}', '--project', 'demo', '--json'],
      placeholders: { task_id: parentFromList },
      fixture: 'active_recurring_task',
      fixture_note: 'an active recurring task with a pending occurrence',
    },
  },
  {
    path: ['occurrence', 'get'],
    purpose: 'Read one frozen occurrence through its project and recurring parent.',
    kind: 'read',
    scope: 'project',
    positional: [taskId, { name: 'occurrence-id', description: 'Occurrence ID' }],
    options: readOptions,
    example: {
      argv: [
        'occurrence',
        'get',
        '{{task_id}}',
        '{{occurrence_id}}',
        '--project',
        'demo',
        '--json',
      ],
      placeholders: { task_id: parentFromList, occurrence_id: occurrenceFromList },
      fixture: 'active_recurring_task',
      fixture_note: 'an active recurring task with a pending occurrence',
    },
  },
  {
    path: ['occurrence', 'complete'],
    purpose: 'Complete selected occurrences of one recurring task atomically.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: async () =>
      (await import('../../../schema/recurrence-input.js')).completeOccurrencesSchema,
    mutation: 'occurrence.complete',
    example: {
      argv: [
        'occurrence',
        'complete',
        '{{task_id}}',
        '--project',
        'demo',
        '--input',
        '-',
        '--json',
      ],
      input: {
        ...tokens,
        expected_settings_revision: '{{settings_revision}}',
        occurrences: [{ id: '{{occurrence_id}}', expected_revision: '{{occurrence_revision}}' }],
      },
      placeholders: tokenSources,
      fixture: 'active_recurring_task',
      fixture_note: 'an active recurring task with a pending occurrence',
    },
  },
  {
    path: ['occurrence', 'miss'],
    purpose:
      'Record selected occurrences as missed now, add a reason to a miss, or close owed work with a reason.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: async () => (await import('../../../schema/recurrence-input.js')).missOccurrencesSchema,
    mutation: 'occurrence.miss',
    example: {
      argv: ['occurrence', 'miss', '{{task_id}}', '--project', 'demo', '--input', '-', '--json'],
      input: {
        ...tokens,
        expected_settings_revision: '{{settings_revision}}',
        occurrences: [{ id: '{{occurrence_id}}', expected_revision: '{{occurrence_revision}}' }],
        reason: 'The person said no today',
      },
      placeholders: tokenSources,
      fixture: 'active_recurring_task',
      fixture_note: 'an active recurring task with a pending occurrence',
    },
  },
  {
    path: ['occurrence', 'cancel'],
    purpose: 'Cancel selected future occurrences of a paused recurring task atomically.',
    kind: 'mutation',
    scope: 'project',
    positional: [taskId],
    options: mutationOptions,
    input: async () =>
      (await import('../../../schema/recurrence-input.js')).cancelOccurrencesSchema,
    mutation: 'occurrence.cancel',
    example: {
      argv: ['occurrence', 'cancel', '{{task_id}}', '--project', 'demo', '--input', '-', '--json'],
      input: {
        ...tokens,
        occurrences: [{ id: '{{occurrence_id}}', expected_revision: '{{occurrence_revision}}' }],
        reason: 'Not needed this week',
      },
      placeholders: {
        new_uuid: tokenSources.new_uuid,
        database_epoch: tokenSources.database_epoch,
        task_revision: tokenSources.task_revision,
        config_revision: tokenSources.config_revision,
        task_id: parentFromList,
        occurrence_id: occurrenceFromList,
        occurrence_revision: tokenSources.occurrence_revision,
      },
      fixture: 'paused_recurring_with_future',
      fixture_note: 'a paused recurring task with a future pending occurrence',
    },
  },
];
