import type { Command } from 'commander';
import {
  readCommand,
  readOptions,
  requireEmptyInput,
  requireSubcommand,
  runMutation,
  writeSuccess,
} from '../command-helpers.js';
import { scopedInput } from '../io.js';
import { readScope } from '../options.js';

export function registerSettingsCommands(program: Command): void {
  const family = program
    .command('settings')
    .description('Read global settings or update them with explicit project attribution')
    .action(requireSubcommand);
  family
    .command('get')
    .description('Read global settings in an explicit project or aggregate scope')
    .action(async (_options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, readOptions);
      const scope = readScope(options);
      requireEmptyInput(scopedInput(options, body));
      const [{ getSettings }, context] = await Promise.all([
        import('../../core/projects/settings.js'),
        import('../context.js'),
      ]);
      const result = await context.withCliDatabase((connection) =>
        getSettings(context.createReadContext({ connection }), scope),
      );
      writeSuccess(result, options);
    });
  family
    .command('update')
    .description('Change timezone with original settings and configuration revision guards')
    .action(async (_options: unknown, command: Command) => {
      const { updateSettings } = await import('../../core/projects/settings.js');
      return runMutation(command, updateSettings);
    });
}
