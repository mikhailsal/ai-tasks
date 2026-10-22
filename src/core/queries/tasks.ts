import { eq } from 'drizzle-orm';
import * as z from 'zod/mini';
import { tasks } from '../../schema/entities.js';
import { successEnvelopeSchema } from '../../schema/envelopes.js';
import { taskDetailSchema, taskResourceSchema } from '../../schema/tasks.js';
import type { CoreContext } from '../database/types.js';
import { readProjectConfiguration, requireProject } from '../projects/read.js';
import { readTaskDetail, requireTask } from '../tasks/read.js';
import { readClock } from '../time.js';
import { queryMetadata, queryState } from './page.js';
import { readTaskPage } from './task-page.js';
import type { taskListInputSchema } from './task-query-sql.js';
import { effectiveTaskDeadline } from './task-query-sql.js';
export { taskListInputSchema } from './task-query-sql.js';
type ReadContext = Pick<CoreContext, 'connection' | 'now'>;
const detailEnvelopeSchema = z.extend(successEnvelopeSchema, { data: taskDetailSchema });
const pageEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({
    items: z.array(taskResourceSchema),
    next_cursor: z.nullable(z.string()),
  }),
});
export function getTask(context: ReadContext, projectSlug: string, taskId: string) {
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    const project = requireProject(transaction, projectSlug);
    const task = requireTask(transaction, projectSlug, taskId);
    const config = readProjectConfiguration(transaction, project);
    const displayDeadline =
      task.kind === 'ordinary'
        ? task.deadline
        : (transaction
            .select({ deadline: effectiveTaskDeadline })
            .from(tasks)
            .where(eq(tasks.id, task.id))
            .get()?.deadline ?? null);
    const options = { task, project, config, displayDeadline };
    return detailEnvelopeSchema.parse({
      ok: true,
      data: readTaskDetail(transaction, options),
      meta: queryMetadata(state, now),
    });
  });
}
export function listTasks(context: ReadContext, input: z.input<typeof taskListInputSchema>) {
  const page = readTaskPage(context, input, { family: 'tasks' });
  return pageEnvelopeSchema.parse({
    ok: true,
    data: { items: page.rows.map((row) => row.task), next_cursor: page.nextCursor },
    meta: page.meta,
  });
}
export function isOrdinaryOverdue(
  task: {
    category: string;
    deadline: number | null;
  },
  now: number,
): boolean {
  const unfinished =
    task.category === 'not_started' ||
    task.category === 'in_progress' ||
    task.category === 'review';
  return unfinished && task.deadline !== null && task.deadline < now;
}
