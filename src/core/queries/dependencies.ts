import * as z from 'zod/mini';
import { successEnvelopeSchema } from '../../schema/envelopes.js';
import { dependencyResourceSchema } from '../../schema/tasks.js';
import type { CoreContext } from '../database/types.js';
import { domainError } from '../errors.js';
import { requireProject } from '../projects/read.js';
import { readTaskDependencies } from '../tasks/dependencies-read.js';
import { requireTask } from '../tasks/read.js';
import { readClock } from '../time.js';
import { queryMetadata, queryState } from './page.js';
const dependenciesEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.array(dependencyResourceSchema),
});
export function listDependencies(
  context: Pick<CoreContext, 'connection' | 'now'>,
  projectSlug: string,
  taskId: string,
) {
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    requireProject(transaction, projectSlug);
    const task = requireTask(transaction, projectSlug, taskId);
    if (task.kind !== 'ordinary')
      throw domainError('VALIDATION_ERROR', 'Dependencies require an ordinary task');
    return dependenciesEnvelopeSchema.parse({
      ok: true,
      data: readTaskDependencies(transaction, taskId),
      meta: queryMetadata(state, now),
    });
  });
}
