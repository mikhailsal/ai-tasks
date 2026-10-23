import type { Command } from 'commander';
import { queryInput, readCommand, readOptions, writeSuccess } from '../command-helpers.js';
export function registerBoardRead(family: Command): void {
  family
    .command('board')
    .description('Read one project board column in shared manual order')
    .action(async (_options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, [
        ...readOptions,
        'limit',
        'cursor',
        'q',
        'status',
        'category',
        'kind',
        'emoji',
        'archive',
        'includeTerminal',
        'deadlinePreset',
        'deadlineDay',
      ]);
      const [{ readBoardColumn }, { boardColumnInputSchema }, { parseInput }, context] =
        await Promise.all([
          import('../../core/queries/board.js'),
          import('../../schema/board.js'),
          import('../../core/validation.js'),
          import('../context.js'),
        ]);
      const input = parseInput(boardColumnInputSchema, queryInput(options, body));
      const result = await context.withCliDatabase((connection) =>
        readBoardColumn(context.createReadContext({ connection }), input),
      );
      writeSuccess(result, options);
    });
}
