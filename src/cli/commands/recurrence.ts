import type { Command } from 'commander';
import { requireSubcommand, runMutation, runProjectRead } from '../command-helpers.js';

export function registerRecurrenceCommands(program: Command): void {
  const family = program
    .command('recurrence')
    .description('Read and manage explicitly scoped recurring-task schedules')
    .action(requireSubcommand);
  family
    .command('get <task-id>')
    .description('Read recurrence configuration, lifecycle, deadline, and open counts')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { getRecurrence } = await import('../../core/queries/recurrence.js');
      return runProjectRead(command, (context, slug) => getRecurrence(context, slug, id));
    });
  for (const [name, exportName] of [
    ['configure', 'configureRecurrence'],
    ['control', 'controlRecurrence'],
  ] as const) {
    family
      .command(`${name} <task-id>`)
      .description(`${name} recurrence using the original guarded mutation payload`)
      .action(async (id: string, _options: unknown, command: Command) => {
        const mutations = await import('../../core/recurrence/control.js');
        const mutate = mutations[exportName];
        return runMutation(command, (context, slug, input) => mutate(context, slug, id, input));
      });
  }
  family
    .command('tick')
    .description('Reconcile an explicit parent revision set using the server clock')
    .action(async (_options: unknown, command: Command) => {
      const { tickRecurrence } = await import('../../core/recurrence/tick.js');
      return runMutation(command, tickRecurrence);
    });
}
