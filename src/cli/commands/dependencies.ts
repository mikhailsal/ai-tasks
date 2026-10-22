import type { Command } from 'commander';
import { listDependencies } from '../../core/queries/dependencies.js';
import { addDependency, removeDependency } from '../../core/tasks/dependencies.js';
import { requireSubcommand, runMutation, runProjectRead } from '../command-helpers.js';

export function registerDependencyCommands(program: Command): void {
  const family = program
    .command('dependency')
    .description('Manage explicitly scoped ordinary-task prerequisites')
    .action(requireSubcommand);
  family
    .command('list <task-id>')
    .description('Read prerequisite links and their current satisfaction')
    .action(async (id: string, _options: unknown, command: Command) =>
      runProjectRead(command, (context, slug) => listDependencies(context, slug, id)),
    );
  for (const [name, mutate] of [
    ['add', addDependency],
    ['remove', removeDependency],
  ] as const) {
    family
      .command(`${name} <task-id>`)
      .description(`${name} a prerequisite using its explicit project and task identifiers`)
      .action(async (id: string, _options: unknown, command: Command) =>
        runMutation(command, (context, slug, input) => mutate(context, slug, id, input)),
      );
  }
}
