import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod/mini';
import { projectConfigInputSchema, type ProjectConfigInput } from '../../schema/configuration.js';
import { projectConfigs, projects, tasks } from '../../schema/entities.js';
import type { CoreContext } from '../database/types.js';
import { domainError } from '../errors.js';
import { requireProject } from '../projects/read.js';
import { normalizeEmoji } from '../tasks/emoji.js';
import { taskResource } from '../tasks/read.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { queryFingerprint } from './cursor.js';
import { nextPageCursor, paginationContext, queryMetadata, queryState } from './page.js';
import {
  effectiveTaskDeadline,
  registerTaskSearch,
  taskListInputSchema,
  taskPredicates,
  taskPriorityRank,
  taskPriorityUnset,
} from './task-query-sql.js';
type ReadContext = Pick<CoreContext, 'connection' | 'now'>;
type PageOptions = {
  family: 'tasks' | 'agenda' | 'priorities';
  precedingOrder?: (asOf: number, timezone: string) => SQL[];
};
function joinedConfiguration(snapshot: typeof projectConfigs.$inferSelect | null) {
  if (!snapshot)
    throw domainError('INTERNAL_ERROR', 'The current project configuration is unavailable');
  const parsed = projectConfigInputSchema.safeParse({
    priority_model: snapshot.priorityModel,
    ordinary_workflow: snapshot.ordinaryWorkflow,
    recurring_workflow: snapshot.recurringWorkflow,
  });
  if (!parsed.success)
    throw domainError('INTERNAL_ERROR', 'The stored project configuration is invalid');
  return parsed.data;
}
/** Page parents in SQL before mapping resources; all families share one consistent read transaction. */
export function readTaskPage(
  context: ReadContext,
  input: z.input<typeof taskListInputSchema>,
  options: PageOptions,
) {
  const parsed = parseInput(taskListInputSchema, input);
  const emojiKey = parsed.emoji === undefined ? undefined : normalizeEmoji(parsed.emoji).key;
  registerTaskSearch(context.connection);
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    if (parsed.project_slug !== undefined) requireProject(transaction, parsed.project_slug);
    const query = queryFingerprint({
      ...parsed,
      cursor: undefined,
      emoji: emojiKey,
      q: parsed.q?.toLowerCase(),
      family: options.family,
      order: 'project_priority_model_deadline_created_id_v1',
    });
    const page = paginationContext({ state, query, now, cursor: parsed.cursor });
    const rows = transaction
      .select({
        task: tasks,
        project: projects,
        config: projectConfigs,
        displayDeadline: effectiveTaskDeadline,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectSlug, projects.slug))
      .leftJoin(
        projectConfigs,
        and(
          eq(projectConfigs.projectSlug, projects.slug),
          eq(projectConfigs.revision, projects.configRevision),
        ),
      )
      .where(taskPredicates(parsed, emojiKey))
      .orderBy(
        desc(projects.priority),
        asc(projects.slug),
        ...(options.precedingOrder?.(page.asOf, state.timezone) ?? []),
        asc(taskPriorityUnset),
        asc(taskPriorityRank),
        asc(sql`CASE WHEN ${effectiveTaskDeadline} IS NULL THEN 1 ELSE 0 END`),
        asc(effectiveTaskDeadline),
        asc(tasks.createdAt),
        asc(tasks.id),
      )
      .limit(parsed.limit + 1)
      .offset(page.offset)
      .all();
    const configurations = new Map<string, ProjectConfigInput>();
    const selected = rows.slice(0, parsed.limit).map((row) => {
      let config = configurations.get(row.project.slug);
      if (!config) {
        config = joinedConfiguration(row.config);
        configurations.set(row.project.slug, config);
      }
      return {
        task: taskResource(row.task, row.project, config, row.displayDeadline),
        project: row.project,
        config,
      };
    });
    return {
      rows: selected,
      nextCursor:
        rows.length > parsed.limit
          ? nextPageCursor({ state, query, asOf: page.asOf, offset: page.offset + selected.length })
          : null,
      meta: queryMetadata(state, now, page.asOf),
      asOf: page.asOf,
      timezone: state.timezone,
    };
  });
}
export type TaskPageRow = ReturnType<typeof readTaskPage>['rows'][number];
