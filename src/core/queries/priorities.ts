import type { z } from 'zod/mini';
import type { prioritiesInputSchema } from '../../schema/read-views.js';
import { prioritiesPageEnvelopeSchema } from '../../schema/read-views.js';
import type { CoreContext } from '../database/types.js';
import { readTaskPage } from './task-page.js';
import { groupTaskRows } from './task-view-groups.js';
export function listPriorities(
  context: Pick<CoreContext, 'connection' | 'now'>,
  input: z.input<typeof prioritiesInputSchema>,
) {
  const page = readTaskPage(context, input, { family: 'priorities' });
  return prioritiesPageEnvelopeSchema.parse({
    ok: true,
    data: { groups: groupTaskRows(page.rows, (row) => row.task), next_cursor: page.nextCursor },
    meta: page.meta,
  });
}
