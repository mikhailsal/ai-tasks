import type { Command } from 'commander';
import { z } from 'zod/mini';
import { parseInput } from '../../core/validation.js';
import { descriptionSchema } from '../../schema/values.js';
import { requireSubcommand, runProjectRead } from '../command-helpers.js';
const previewInputSchema = z.strictObject({ description: descriptionSchema });
export function registerDescriptionCommands(program: Command): void {
  program
    .command('description')
    .description('Preview saved-description Markdown')
    .action(requireSubcommand)
    .command('preview')
    .description('Render Markdown without saving it')
    .action(async (_options: unknown, command: Command) => {
      const { previewDescription } = await import('../../core/markdown/preview.js');
      return runProjectRead(
        command,
        (context, slug, body) =>
          previewDescription(context, slug, parseInput(previewInputSchema, body)),
        true,
      );
    });
}
