#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import * as z from 'zod/mini';
import { domainError } from '../core/errors.js';
import { writeFailure, writeJson } from './io.js';
import { addCommonOptions, commandOptions, requireOptions } from './options.js';
import { registerProjectCommands } from './commands/projects.js';
import { registerTaskCommands } from './commands/tasks.js';
import { registerConfigurationCommands } from './commands/configuration.js';
import { registerDescriptionCommands } from './commands/descriptions.js';
import { registerDependencyCommands } from './commands/dependencies.js';
import { registerMetaCommands } from './commands/meta.js';
import { registerServeCommands } from './commands/serve.js';
import { registerAuditCommands } from './commands/audit.js';
import { registerWorkerCommands } from './commands/worker.js';
import { registerRecurrenceCommands } from './commands/recurrence.js';
import { registerOccurrenceCommands } from './commands/occurrences.js';
import { registerSettingsCommands } from './commands/settings.js';
import { registerViewCommands } from './commands/views.js';
import { registerBackupCommands } from './commands/backups.js';
function packageVersion(): string {
  const path = findPackageJSON(import.meta.url);
  if (!path) throw domainError('INTERNAL_ERROR', 'CLI package metadata is unavailable');
  return z
    .object({ version: z.string().check(z.minLength(1)) })
    .parse(JSON.parse(readFileSync(path, 'utf8'))).version;
}
export function createProgram(): Command {
  const program = addCommonOptions(new Command());
  program.name('ai-tasks').description('Local task state engine').version(packageVersion());
  program.exitOverride().configureOutput({
    writeOut: (text) => {
      process.stdout.write(text);
    },
    writeErr: () => {},
    outputError: () => {},
  });
  program.addHelpCommand(false).showHelpAfterError(false).showSuggestionAfterError(false);
  program.action(() => {
    throw domainError('VALIDATION_ERROR', 'Choose an application command');
  });
  program
    .command('help')
    .description('Show command help')
    .action((_options: unknown, command: Command) => {
      const options = commandOptions(command);
      requireOptions(options, ['json']);
      const help = program.helpInformation();
      if (options.json) writeJson({ ok: true, data: { help } });
      else process.stdout.write(help);
    });
  program
    .command('version')
    .description('Show application version')
    .action((_options: unknown, command: Command) => {
      const options = commandOptions(command);
      requireOptions(options, ['json']);
      if (options.json) writeJson({ ok: true, data: { version: program.version() } });
      else process.stdout.write(`${program.version()}\n`);
    });
  registerMetaCommands(program);
  registerServeCommands(program);
  registerProjectCommands(program);
  registerTaskCommands(program);
  registerConfigurationCommands(program);
  registerDescriptionCommands(program);
  registerDependencyCommands(program);
  registerAuditCommands(program);
  registerWorkerCommands(program);
  registerRecurrenceCommands(program);
  registerOccurrenceCommands(program);
  registerSettingsCommands(program);
  registerViewCommands(program);
  registerBackupCommands(program);
  return program;
}
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    await createProgram().parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return;
      writeFailure(domainError('VALIDATION_ERROR', 'Invalid command arguments'));
    } else writeFailure(error);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
