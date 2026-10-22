import type { Command } from 'commander';
import { domainError } from '../../core/errors.js';
import { writeJson } from '../io.js';
import { commandOptions, readScope, requireOptions } from '../options.js';

export function registerServeCommands(program: Command): void {
  program
    .command('serve')
    .description('Start the loopback API and web interface')
    .action(async (_options: unknown, command: Command) => {
      const options = commandOptions(command);
      requireOptions(options, ['json', 'allProjects', 'project']);
      const scope = readScope(options);
      if (!('all_projects' in scope))
        throw domainError('VALIDATION_ERROR', 'Serve requires --all-projects');
      const { serveApi } = await import('../context.js');
      await serveApi((result) => {
        if (options.json) writeJson(result);
        else process.stdout.write('API is ready on the configured loopback port\n');
      });
    });
}
