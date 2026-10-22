import type { Command } from 'commander';
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
      const [{ listTasks, taskListInputSchema }, { parseInput }, context] = await Promise.all([
        import('../../core/queries/tasks.js'),
        import('../../core/validation.js'),
        import('../context.js'),
      ]);
      const input = parseInput(taskListInputSchema, queryInput(options, body));
      const result = await context.withCliDatabase((connection) =>
        listTasks(context.createReadContext({ connection }), input),
      );
      writeSuccess(result, options);
    });
  family
    .command('get <task-id>')
    .description('Read a task and its saved description')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { getTask } = await import('../../core/queries/tasks.js');
      return runProjectRead(command, (context, slug) => getTask(context, slug, id));
    });
  family
    .command('create')
    .description('Create an ordinary or recurring task')
    .action(async (_options: unknown, command: Command) => {
      const { createTask } = await import('../../core/tasks/commands.js');
      return runMutation(command, createTask);
    });
  for (const name of ['update', 'transition', 'archive', 'restore'] as const) {
    family
      .command(`${name} <task-id>`)
      .description(`${name} an ordinary or recurring task`)
      .action(async (id: string, _options: unknown, command: Command) => {
        if (name === 'transition') {
          const { transitionTask } = await import('../../core/tasks/transitions.js');
          return runMutation(command, (context, slug, input) =>
            transitionTask(context, slug, id, input),
          );
        }
        const mutations = await import('../../core/tasks/commands.js');
        const mutate =
          name === 'update'
            ? mutations.updateTask
            : name === 'archive'
              ? mutations.archiveTask
              : mutations.restoreTask;
        return runMutation(command, (context, slug, input) => mutate(context, slug, id, input));
      });
  }
}
