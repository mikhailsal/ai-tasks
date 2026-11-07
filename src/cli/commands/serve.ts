import { networkInterfaces } from 'node:os';
import type { Command } from 'commander';
import { domainError } from '../../core/errors.js';
import { resolveListenAddress, type ListenAddress } from '../../runtime/listen-address.js';
import { writeJson } from '../io.js';
import { commandOptions, readScope, requireOptions } from '../options.js';

function readyText(address: ListenAddress): string {
  if (!address.network) return 'API is ready on the configured loopback port\n';
  return (
    `Web interface on the local network: ${address.origin}/\n` +
    'Warning: every device on this network can read and change all data without signing in.\n' +
    'Offline reopening is unavailable over plain HTTP; an open tab keeps showing loaded data.\n'
  );
}

export function registerServeCommands(program: Command): void {
  program
    .command('serve')
    .description('Start the API and web interface (loopback unless AI_TASKS_HOST is set)')
    .action(async (_options: unknown, command: Command) => {
      const options = commandOptions(command);
      requireOptions(options, ['json', 'allProjects', 'project']);
      const scope = readScope(options);
      if (!('all_projects' in scope))
        throw domainError('VALIDATION_ERROR', 'Serve requires --all-projects');
      // The API child reports only fixed failure text, so explain configuration errors here.
      const address = resolveListenAddress(process.env, networkInterfaces());
      const { serveApi } = await import('../context.js');
      await serveApi((result) => {
        if (options.json) writeJson(result);
        else process.stdout.write(readyText(address));
      });
    });
}
