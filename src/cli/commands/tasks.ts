import type { Command } from 'commander';
import { createTask, updateTask, archiveTask, restoreTask } from '../../core/tasks/commands.js';
import { transitionTask } from '../../core/tasks/transitions.js';
import { getTask, listTasks, taskListInputSchema } from '../../core/queries/tasks.js';
import { parseInput } from '../../core/validation.js';
import { createReadContext, withCliDatabase } from '../context.js';
import {
  queryInput,
  readCommand,
  readOptions,
  requireSubcommand,
  runMutation,
  runProjectRead,
  writeSuccess,
} from '../command-helpers.js';

export function registerTaskCommands(program: Command): void {
  const family = program
    .command('task')
    .description('Manage ordinary and recurring tasks')
    .action(requireSubcommand);
  family
    .command('list')
    .description('List tasks in an explicit scope')
    .action(async (_options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, [
        ...readOptions,
        'limit',
        'cursor',
        'q',
        'status',
        'category',
        'kind',
        'emoji',
        'archive',
        'includeTerminal',
      ]);
      const input = parseInput(taskListInputSchema, queryInput(options, body));
      const result = await withCliDatabase((connection) =>
        listTasks(createReadContext({ connection }), input),
      );
      writeSuccess(result, options);
    });
  family
    .command('get <task-id>')
    .description('Read a task and its saved description')
    .action(async (id: string, _options: unknown, command: Command) =>
      runProjectRead(command, (context, slug) => getTask(context, slug, id)),
    );
  family
    .command('create')
    .description('Create an ordinary or recurring task')
    .action(async (_options: unknown, command: Command) => runMutation(command, createTask));
  for (const [name, mutate] of [
    ['update', updateTask],
    ['transition', transitionTask],
    ['archive', archiveTask],
    ['restore', restoreTask],
  ] as const) {
    family
      .command(`${name} <task-id>`)
      .description(`${name} an ordinary or recurring task`)
      .action(async (id: string, _options: unknown, command: Command) =>
        runMutation(command, (context, slug, input) => mutate(context, slug, id, input)),
      );
  }
}
