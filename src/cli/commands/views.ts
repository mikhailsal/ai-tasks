import type { Command } from 'commander';
import type { z } from 'zod/mini';
import { queryInput, readCommand, readOptions, writeSuccess } from '../command-helpers.js';
import type { createReadContext } from '../context.js';
import type { CliOptions } from '../options.js';
const filters = ['q', 'status', 'category', 'kind', 'emoji', 'archive', 'includeTerminal'] as const;
function registerView<Schema extends z.ZodMiniType>(
  program: Command,
  options: {
    name: string;
    description: string;
    allowed: readonly (keyof CliOptions)[];
    load: () => Promise<{
      schema: Schema;
      read: (context: ReturnType<typeof createReadContext>, input: z.output<Schema>) => unknown;
    }>;
  },
) {
  program
    .command(options.name)
    .description(options.description)
    .action(async (_options: unknown, command: Command) => {
      const { options: flags, body } = await readCommand(command, options.allowed);
      const [{ parseInput }, view, context] = await Promise.all([
        import('../../core/validation.js'),
        options.load(),
        import('../context.js'),
      ]);
      const input = parseInput(view.schema, queryInput(flags, body));
      const result = await context.withCliDatabase((connection) =>
        view.read(context.createReadContext({ connection }), input),
      );
      writeSuccess(result, flags);
    });
}
export function registerViewCommands(program: Command): void {
  const pagedOptions = [...readOptions, ...filters, 'limit', 'cursor'] as const;
  registerView(program, {
    name: 'agenda',
    description: 'Read project-grouped local calendar buckets at one captured instant',
    allowed: pagedOptions,
    load: async () => {
      const [{ agendaInputSchema }, { listAgenda }] = await Promise.all([
        import('../../schema/read-views.js'),
        import('../../core/queries/agenda.js'),
      ]);
      return { schema: agendaInputSchema, read: listAgenda };
    },
  });
  registerView(program, {
    name: 'priorities',
    description: 'Read priorities within each project and its configured model',
    allowed: pagedOptions,
    load: async () => {
      const [{ prioritiesInputSchema }, { listPriorities }] = await Promise.all([
        import('../../schema/read-views.js'),
        import('../../core/queries/priorities.js'),
      ]);
      return { schema: prioritiesInputSchema, read: listPriorities };
    },
  });
  registerView(program, {
    name: 'stats',
    description: 'Read separate task and occurrence counts; JSON from/to bounds are half-open',
    allowed: [...readOptions, ...filters],
    load: async () => {
      const [{ statisticsInputSchema }, { getStatistics }] = await Promise.all([
        import('../../schema/read-views.js'),
        import('../../core/queries/statistics.js'),
      ]);
      return { schema: statisticsInputSchema, read: getStatistics };
    },
  });
}
