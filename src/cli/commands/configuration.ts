import type { Command } from 'commander';
import { previewConfiguration, migrateConfiguration } from '../../core/projects/configuration.js';
import { getProjectConfiguration, readConfigPresets } from '../../core/queries/configuration.js';
import { createReadContext, withCliDatabase } from '../context.js';
import { scopedInput } from '../io.js';
import { readScope } from '../options.js';
import {
  readCommand,
  readOptions,
  requireEmptyInput,
  requireSubcommand,
  runProjectRead,
  runMutation,
  writeSuccess,
} from '../command-helpers.js';

export function registerConfigurationCommands(program: Command): void {
  const family = program
    .command('config')
    .description('Read, preview, and migrate project configuration')
    .action(requireSubcommand);
  family
    .command('get')
    .description('Read current project configuration')
    .action(async (_options: unknown, command: Command) =>
      runProjectRead(command, getProjectConfiguration),
    );
  family
    .command('preview')
    .description('Preview configuration mappings and affected tasks without saving')
    .action(async (_options: unknown, command: Command) =>
      runProjectRead(command, previewConfiguration, true),
    );
  family
    .command('migrate')
    .description('Apply a complete configuration migration atomically')
    .action(async (_options: unknown, command: Command) =>
      runMutation(command, migrateConfiguration),
    );
  family
    .command('presets')
    .description('Read built-in priority and workflow presets')
    .action(async (_options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, readOptions);
      const scope = readScope(options);
      requireEmptyInput(scopedInput(options, body));
      const result = await withCliDatabase((connection) =>
        readConfigPresets(createReadContext({ connection }), scope),
      );
      writeSuccess(result, options);
    });
}
