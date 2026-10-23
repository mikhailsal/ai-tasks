import type { z } from 'zod/mini';
import { boardColumnEnvelopeSchema, boardColumnInputSchema } from '../../schema/board.js';
import type { CoreContext } from '../database/types.js';
import { domainError } from '../errors.js';
import { readProjectConfiguration, requireProject } from '../projects/read.js';
import { parseInput } from '../validation.js';
import { readTaskPage } from './task-page.js';
export function readBoardColumn(
  context: Pick<CoreContext, 'connection' | 'now'>,
  input: z.input<typeof boardColumnInputSchema>,
) {
  const parsed = parseInput(boardColumnInputSchema, input);
  if (parsed.all_projects !== undefined)
    throw domainError('VALIDATION_ERROR', 'Board reads require one project');
  return context.connection.db.transaction((transaction) => {
    // Configuration revisions participate in the cursor; validate stage IDs even for empty columns.
    const project = requireProject(transaction, parsed.project_slug);
    const config = readProjectConfiguration(transaction, project);
    const workflow =
      parsed.kind === 'ordinary' ? config.ordinary_workflow : config.recurring_workflow;
    if (!workflow.statuses.some((status) => status.id === parsed.status_id))
      throw domainError('VALIDATION_ERROR', 'The board column is not in the configured workflow');
    const page = readTaskPage(context, parsed, { family: 'board', boardOrder: true });
    return boardColumnEnvelopeSchema.parse({
      ok: true,
      data: {
        items: page.rows.map((row) => row.task),
        next_cursor: page.nextCursor,
        order_revision: page.orderRevision,
      },
      meta: page.meta,
    });
  });
}
