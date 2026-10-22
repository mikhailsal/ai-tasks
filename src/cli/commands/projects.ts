import type { Command } from 'commander';
import {
  createProject,
  updateProject,
  archiveProject,
  restoreProject,
} from '../../core/projects/commands.js';
import { getProject, listProjects, projectListInputSchema } from '../../core/queries/projects.js';
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
      const input = parseInput(projectListInputSchema, queryInput(options, body));
      const result = await withCliDatabase((connection) =>
        listProjects(createReadContext({ connection }), input),
      );
      writeSuccess(result, options);
    });
  family
    .command('get')
    .description('Read the selected project')
    .action(async (_options: unknown, command: Command) => runProjectRead(command, getProject));
  for (const [name, mutate] of [
    ['create', createProject],
    ['update', updateProject],
    ['archive', archiveProject],
    ['restore', restoreProject],
  ] as const) {
    family
      .command(name)
      .description(`${name} the selected project`)
      .action(async (_options: unknown, command: Command) => runMutation(command, mutate));
  }
}
