import type { Command } from 'commander';
import { domainError } from '../../core/errors.js';
import { getOccurrence, listOccurrences } from '../../core/queries/recurrence.js';
import { cancelOccurrences } from '../../core/recurrence/cancel.js';
import { completeOccurrences } from '../../core/recurrence/complete.js';
import { parseInput } from '../../core/validation.js';
import { occurrenceListInputSchema } from '../../schema/recurrence-query.js';
import {
  readCommand,
  readOptions,
  requireSubcommand,
  runMutation,
  runProjectRead,
  singleProjectInput,
  writeSuccess,
} from '../command-helpers.js';
import { createReadContext, withCliDatabase } from '../context.js';
import type { CliInput } from '../io.js';
import { positiveIntegerOption, type CliOptions } from '../options.js';

/** Preserve unknown own JSON keys for authoritative strict validation. */
export function occurrenceQueryInput(options: CliOptions, body: CliInput) {
  const input = singleProjectInput(options, body);
  for (const field of ['state', 'limit', 'cursor'] as const) {
    const value = options[field];
    if (value === undefined) continue;
    if (Object.hasOwn(input.body, field))
      throw domainError('VALIDATION_ERROR', 'Query field cannot appear in both flags and JSON');
    input.body[field] = field === 'limit' ? positiveIntegerOption(value) : value;
  }
  return {
    projectSlug: input.projectSlug,
    query: parseInput(occurrenceListInputSchema, input.body),
  };
}

export function registerOccurrenceCommands(program: Command): void {
  const family = program
    .command('occurrence')
    .description('Read and resolve occurrences belonging to an explicit recurring parent')
    .action(requireSubcommand);
  family
    .command('list <task-id>')
    .description('List frozen occurrences with optional state and pagination filters')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, [
        ...readOptions,
        'state',
        'limit',
        'cursor',
      ]);
      const { projectSlug, query } = occurrenceQueryInput(options, body);
      const result = await withCliDatabase((connection) =>
        listOccurrences(createReadContext({ connection }), projectSlug, id, query),
      );
      writeSuccess(result, options);
    });
  family
    .command('get <task-id> <occurrence-id>')
    .description('Read one frozen occurrence through its owning project and parent')
    .action(async (id: string, occurrenceId: string, _options: unknown, command: Command) =>
      runProjectRead(command, (context, slug) => getOccurrence(context, slug, id, occurrenceId)),
    );
  for (const [name, mutate] of [
    ['complete', completeOccurrences],
    ['cancel', cancelOccurrences],
  ] as const) {
    family
      .command(`${name} <task-id>`)
      .description(`${name} selected occurrence revisions atomically`)
      .action(async (id: string, _options: unknown, command: Command) =>
        runMutation(command, (context, slug, input) => mutate(context, slug, id, input)),
      );
  }
}
