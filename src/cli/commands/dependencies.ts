import type { Command } from 'commander';
import { requireSubcommand, runMutation, runProjectRead } from '../command-helpers.js';

export function registerDependencyCommands(program: Command): void {
  const family = program
    .command('dependency')
    .description('Manage explicitly scoped ordinary-task prerequisites')
    .action(requireSubcommand);
  family
    .command('list <task-id>')
    .description('Read prerequisite links and their current satisfaction')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { listDependencies } = await import('../../core/queries/dependencies.js');
      return runProjectRead(command, (context, slug) => listDependencies(context, slug, id));
    });
  for (const [name, exportName] of [
    ['add', 'addDependency'],
    ['remove', 'removeDependency'],
  ] as const) {
    family
      .command(`${name} <task-id>`)
      .description(`${name} a prerequisite using its explicit project and task identifiers`)
      .action(async (id: string, _options: unknown, command: Command) => {
        const mutations = await import('../../core/tasks/dependencies.js');
        const mutate = mutations[exportName];
        return runMutation(command, (context, slug, input) => mutate(context, slug, id, input));
      });
  }
}
