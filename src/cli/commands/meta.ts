import type { Command } from 'commander';
import { domainError } from '../../core/errors.js';
import { requireEmptyInput } from '../command-helpers.js';
import { readJsonInput, scopedInput, writeJson } from '../io.js';
import { commandOptions, readScope, requireOptions } from '../options.js';

export function registerMetaCommands(program: Command): void {
  program
    .command('meta')
    .description('Read global metadata without mutations')
    .action(async (_options: unknown, command: Command) => {
      const options = commandOptions(command);
      requireOptions(options, ['json', 'allProjects', 'project', 'input']);
      const scope = readScope(options);
      if (!('all_projects' in scope))
        throw domainError('VALIDATION_ERROR', 'Metadata requires --all-projects');
      requireEmptyInput(scopedInput(options, await readJsonInput(options.input)));
      const [{ readMeta }, context] = await Promise.all([
        import('../../core/queries/meta.js'),
        import('../context.js'),
      ]);
      const result = await context.withCliDatabase((connection) =>
        readMeta(context.createReadContext({ connection }), scope),
      );
      if (options.json) writeJson(result);
      else
        process.stdout.write(
          `Schema ${result.data.schema_version}; timezone ${result.data.timezone}; epoch ${result.data.database_epoch}\n`,
        );
    });
}
