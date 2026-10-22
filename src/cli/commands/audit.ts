import type { Command } from 'commander';
import {
  queryInput,
  readCommand,
  readOptions,
  requireSubcommand,
  writeSuccess,
} from '../command-helpers.js';

export function registerAuditCommands(program: Command): void {
  program
    .command('audit')
    .description('Read immutable history in an explicit scope')
    .action(requireSubcommand)
    .command('list')
    .description('List audit events by project, entity, operation, and page')
    .action(async (_options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, [
        ...readOptions,
        'entityId',
        'operation',
        'limit',
        'cursor',
      ]);
      const [{ listAudit }, { parseInput }, { auditListInputSchema }, context] = await Promise.all([
        import('../../core/queries/audit.js'),
        import('../../core/validation.js'),
        import('../../schema/audit.js'),
        import('../context.js'),
      ]);
      const input = parseInput(auditListInputSchema, queryInput(options, body));
      const result = await context.withCliDatabase((connection) =>
        listAudit(context.createReadContext({ connection }), input),
      );
      writeSuccess(result, options);
    });
}
