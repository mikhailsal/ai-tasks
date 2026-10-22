import type { Command } from 'commander';
import { listAudit } from '../../core/queries/audit.js';
import { parseInput } from '../../core/validation.js';
import { auditListInputSchema } from '../../schema/audit.js';
import { createReadContext, withCliDatabase } from '../context.js';
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
      const input = parseInput(auditListInputSchema, queryInput(options, body));
      const result = await withCliDatabase((connection) =>
        listAudit(createReadContext({ connection }), input),
      );
      writeSuccess(result, options);
    });
}
