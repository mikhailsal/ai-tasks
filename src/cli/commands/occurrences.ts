import type { Command } from 'commander';
import { domainError } from '../../core/errors.js';
import { parseInput } from '../../core/validation.js';
import { occurrenceListInputSchema } from '../../schema/recurrence-query.js';
import {
  readCommand,
  requireSubcommand,
  runMutation,
  runProjectRead,
  runShortcut,
  singleProjectInput,
  writeSuccess,
} from '../command-helpers.js';
import type { CliInput } from '../io.js';
import { commandOptions, positiveIntegerOption, type CliOptions } from '../options.js';

const flagFields = [
  ['state', 'state'],
  ['limit', 'limit'],
  ['cursor', 'cursor'],
  ['day', 'day'],
  ['fromDay', 'from_day'],
  ['toDay', 'to_day'],
] as const;

/** Copies query flags into the JSON body; a field in both is refused. */
function withFlags(options: CliOptions, body: CliInput, fields: readonly string[]) {
  for (const [option, field] of flagFields) {
    const value = options[option];
    if (value === undefined || !fields.includes(field)) continue;
    if (Object.hasOwn(body, field))
      throw domainError('VALIDATION_ERROR', 'Query field cannot appear in both flags and JSON');
    body[field] = field === 'limit' ? positiveIntegerOption(value) : value;
  }
  return body;
}

/** Preserve unknown own JSON keys for authoritative strict validation. */
export function occurrenceQueryInput(options: CliOptions, body: CliInput) {
  const input = singleProjectInput(options, body);
  withFlags(options, input.body, ['state', 'limit', 'cursor', 'day', 'from_day', 'to_day']);
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
      const { options, body } = await readCommand(command);
      const { projectSlug, query } = occurrenceQueryInput(options, body);
      const [{ listOccurrences }, context] = await Promise.all([
        import('../../core/queries/recurrence.js'),
        import('../context.js'),
      ]);
      const result = await context.withCliDatabase((connection) =>
        listOccurrences(context.createReadContext({ connection }), projectSlug, id, query),
      );
      writeSuccess(result, options);
    });
  family
    .command('progress <task-id>')
    .description('Count outcomes over an inclusive window of occurrence days')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { occurrenceProgress } = await import('../../core/queries/progress.js');
      return runProjectRead(
        command,
        (context, slug, body) =>
          occurrenceProgress(
            context,
            slug,
            id,
            withFlags(commandOptions(command), body, ['from_day', 'to_day']),
          ),
        true,
      );
    });
  family
    .command('get <task-id> <occurrence-id>')
    .description('Read one frozen occurrence through its owning project and parent')
    .action(async (id: string, occurrenceId: string, _options: unknown, command: Command) => {
      const { getOccurrence } = await import('../../core/queries/recurrence.js');
      return runProjectRead(command, (context, slug) =>
        getOccurrence(context, slug, id, occurrenceId),
      );
    });
  for (const [name, moduleName] of [
    ['complete', 'complete'],
    ['cancel', 'cancel'],
  ] as const) {
    family
      .command(`${name} <task-id>`)
      .description(`${name} selected occurrence revisions atomically`)
      .action(async (id: string, _options: unknown, command: Command) => {
        const mutate =
          moduleName === 'complete'
            ? (await import('../../core/recurrence/complete.js')).completeOccurrences
            : (await import('../../core/recurrence/cancel.js')).cancelOccurrences;
        return runMutation(command, (context, slug, input) => mutate(context, slug, id, input));
      });
  }
  family
    .command('done <task>')
    .description('Complete the occurrence of a task on a day, without reading revisions first')
    .action(async (task: string, _options: unknown, command: Command) => {
      const { completeByDay } = await import('../../core/shortcuts/complete-by-day.js');
      return runShortcut(
        command,
        (options) => ({
          task,
          day: options.day,
          occurrence: options.occurrence,
          at: options.at,
          note: options.note,
        }),
        (context, slug, input) => completeByDay(context, slug, input),
      );
    });
  family
    .command('miss <task-id>')
    .description('record selected occurrences as missed, optionally with a reason')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { missOccurrences } = await import('../../core/recurrence/miss.js');
      return runMutation(command, (context, slug, input) =>
        missOccurrences(context, slug, id, input),
      );
    });
}
