import type { Command } from 'commander';
import type { z } from 'zod/mini';
import { listAgenda } from '../../core/queries/agenda.js';
import { listPriorities } from '../../core/queries/priorities.js';
import { getStatistics } from '../../core/queries/statistics.js';
import { parseInput } from '../../core/validation.js';
import {
  agendaInputSchema,
  prioritiesInputSchema,
  statisticsInputSchema,
} from '../../schema/read-views.js';
import { queryInput, readCommand, readOptions, writeSuccess } from '../command-helpers.js';
import { createReadContext, withCliDatabase } from '../context.js';
import type { CliOptions } from '../options.js';
const filters = ['q', 'status', 'category', 'kind', 'emoji', 'archive', 'includeTerminal'] as const;
function registerView<Schema extends z.ZodMiniType>(
  program: Command,
  options: {
    name: string;
    description: string;
    schema: Schema;
    allowed: readonly (keyof CliOptions)[];
    read: (context: ReturnType<typeof createReadContext>, input: z.output<Schema>) => unknown;
  },
) {
  program
    .command(options.name)
    .description(options.description)
    .action(async (_options: unknown, command: Command) => {
      const { options: flags, body } = await readCommand(command, options.allowed);
      const input = parseInput(options.schema, queryInput(flags, body));
      const result = await withCliDatabase((connection) =>
        options.read(createReadContext({ connection }), input),
      );
      writeSuccess(result, flags);
    });
}
export function registerViewCommands(program: Command): void {
  const pagedOptions = [...readOptions, ...filters, 'limit', 'cursor'] as const;
  registerView(program, {
    name: 'agenda',
    description: 'Read project-grouped local calendar buckets at one captured instant',
    schema: agendaInputSchema,
    allowed: pagedOptions,
    read: listAgenda,
  });
  registerView(program, {
    name: 'priorities',
    description: 'Read priorities within each project and its configured model',
    schema: prioritiesInputSchema,
    allowed: pagedOptions,
    read: listPriorities,
  });
  registerView(program, {
    name: 'stats',
    description: 'Read separate task and occurrence counts; JSON from/to bounds are half-open',
    schema: statisticsInputSchema,
    allowed: [...readOptions, ...filters],
    read: getStatistics,
  });
}
