import type { Command } from 'commander';
import { domainError } from '../../core/errors.js';
import { writeJson } from '../io.js';
import { commandOptions, readScope, requireOptions } from '../options.js';

export function registerWorkerCommands(program: Command): void {
  program
    .command('worker')
    .command('run')
    .description('Process recurring work for one project')
    .action(async (_options: unknown, command: Command) => {
      const options = commandOptions(command);
      requireOptions(options, ['json', 'project', 'allProjects']);
      const scope = readScope(options);
      if (!('project_slug' in scope))
        throw domainError('VALIDATION_ERROR', 'Worker requires an explicit project');
      try {
        const [{ runRecurrenceWorker }, { withCliDatabase }, { workerCallbacks }] =
          await Promise.all([
            import('../../runtime/recurrence-worker.js'),
            import('../context.js'),
            import('../worker-data.js'),
          ]);
        await withCliDatabase(async (connection) => {
          const callbacks = workerCallbacks(connection, scope.project_slug);
          await runRecurrenceWorker({
            processBatch: callbacks.processBatch,
            onReady() {
              const ready = callbacks.readiness();
              if (options.json) writeJson(ready);
              else process.stdout.write(`Recurring worker is ready for ${scope.project_slug}\n`);
            },
          });
        });
      } finally {
        if (process.connected) process.disconnect();
      }
    });
}
