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

export function registerProjectCommands(program: Command): void {
  const family = program
    .command('project')
    .description('Manage projects')
    .action(requireSubcommand);
  family
    .command('list')
    .description('List projects in an explicit scope')
    .action(async (_options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, [
        ...readOptions,
        'limit',
        'cursor',
        'archive',
      ]);
      const [{ listProjects, projectListInputSchema }, { parseInput }, context] = await Promise.all(
        [
          import('../../core/queries/projects.js'),
          import('../../core/validation.js'),
          import('../context.js'),
        ],
      );
      const input = parseInput(projectListInputSchema, queryInput(options, body));
      const result = await context.withCliDatabase((connection) =>
        listProjects(context.createReadContext({ connection }), input),
      );
      writeSuccess(result, options);
    });
  family
    .command('get')
    .description('Read the selected project')
    .action(async (_options: unknown, command: Command) => {
      const { getProject } = await import('../../core/queries/projects.js');
      return runProjectRead(command, getProject);
    });
  for (const [name, exportName] of [
    ['create', 'createProject'],
    ['update', 'updateProject'],
    ['archive', 'archiveProject'],
    ['restore', 'restoreProject'],
  ] as const) {
    family
      .command(name)
      .description(`${name} the selected project`)
      .action(async (_options: unknown, command: Command) => {
        const mutations = await import('../../core/projects/commands.js');
        return runMutation(command, mutations[exportName]);
      });
  }
}
