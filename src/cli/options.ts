import { type Command, InvalidArgumentError, Option } from 'commander';
import * as z from 'zod/mini';
import { domainError } from '../core/errors.js';
import { readScopeSchema } from '../schema/scopes.js';
export const cliOptionsSchema = z.strictObject({
  json: z.optional(z.boolean()),
  wait: z.optional(z.boolean()),
  project: z.optional(z.string()),
  allProjects: z.optional(z.boolean()),
  operationId: z.optional(z.string()),
  operation: z.optional(z.string()),
  entityId: z.optional(z.string()),
  databaseEpoch: z.optional(z.string()),
  expectedRevision: z.optional(z.string()),
  expectedConfigRevision: z.optional(z.string()),
  expectedSettingsRevision: z.optional(z.string()),
  input: z.optional(z.string()),
  limit: z.optional(z.string()),
  cursor: z.optional(z.string()),
  q: z.optional(z.string()),
  status: z.optional(z.string()),
  state: z.optional(z.string()),
  category: z.optional(z.string()),
  kind: z.optional(z.string()),
  emoji: z.optional(z.string()),
  archive: z.optional(z.string()),
  includeTerminal: z.optional(z.boolean()),
});
export type CliOptions = z.infer<typeof cliOptionsSchema>;
const valueOptions = [
  ['--project <slug>', 'Explicit project scope'],
  ['--operation-id <uuid>', 'Mutation operation ID'],
  ['--operation <uuid>', 'Audit operation UUID filter'],
  ['--entity-id <uuid>', 'Audit entity UUID filter'],
  ['--database-epoch <uuid>', 'Current database epoch'],
  ['--expected-revision <integer>', 'Expected target revision'],
  ['--expected-config-revision <integer>', 'Expected project config revision'],
  ['--expected-settings-revision <integer>', 'Expected global settings revision'],
  ['--input <file>', 'UTF-8 JSON input file, or - for stdin'],
  ['--limit <integer>', 'Page size from 1 to 200'],
  ['--cursor <opaque>', 'Continuation cursor'],
  ['--q <text>', 'Literal text search'],
  ['--status <key>', 'Status filter'],
  ['--state <state>', 'Occurrence outcome state filter'],
  ['--category <key>', 'Category filter'],
  ['--kind <kind>', 'Task kind filter'],
  ['--emoji <emoji>', 'Emoji filter'],
  ['--archive <mode>', 'Archive mode: exclude, include, or only'],
] as const;
export function addCommonOptions(command: Command): Command {
  command
    .option('--json', 'Print one JSON response')
    .option('--include-terminal', 'Include terminal tasks');
  command.addOption(
    new Option('--all-projects', 'Explicit aggregate read scope').conflicts('project'),
  );
  for (const [flags, description] of valueOptions) {
    const option = new Option(flags, description).argParser((value: string, previous: unknown) => {
      if (previous !== undefined)
        throw new InvalidArgumentError('Option may only be supplied once');
      return value;
    });
    if (flags.startsWith('--project ')) option.conflicts('allProjects');
    command.addOption(option);
  }
  return command;
}
export function commandOptions(command: Command): CliOptions {
  return cliOptionsSchema.parse(command.optsWithGlobals());
}
export function requireOptions(options: CliOptions, allowed: readonly (keyof CliOptions)[]): void {
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && !allowed.some((name) => name === key)) {
      throw domainError('VALIDATION_ERROR', 'Option is not supported by this command');
    }
  }
}
export function readScope(options: CliOptions) {
  if (options.project !== undefined && options.allProjects !== undefined) {
    throw domainError('VALIDATION_ERROR', 'Choose either project or all-projects scope');
  }
  return readScopeSchema.parse(
    options.project !== undefined
      ? { project_slug: options.project }
      : { all_projects: options.allProjects },
  );
}
export function positiveIntegerOption(value: string): number {
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw domainError('VALIDATION_ERROR', 'Revision must be a positive safe integer');
  }
  return Number(value);
}
