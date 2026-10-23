import { readBlockedTaskIds } from '../tasks/dependencies-read.js';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod/mini';
import { projectConfigInputSchema } from '../../schema/configuration.js';
import { projectConfigs, projects, tasks } from '../../schema/entities.js';
import { boardColumns, boardOrder } from '../../schema/board-storage.js';
import { taskDeadlinePredicate } from './task-deadline.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
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
  taskCategory,
  taskListInputSchema,
  taskPredicates,
  taskPriorityRank,
  taskPriorityUnset,
} from './task-query-sql.js';
type ReadContext = Pick<CoreContext, 'connection' | 'now'>;
type TaskOrderReferences = {
  deadline: SQL;
  kind: SQL;
  category: SQL;
};
type PageOptions = {
  family: 'tasks' | 'agenda' | 'priorities' | 'board';
  boardOrder?: true;
  precedingOrder?: (asOf: number, timezone: string, refs: TaskOrderReferences) => SQL[];
  materializeOrder?: true;
};
type TaskPageKey = { taskId: string; displayDeadline: number | null };
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
function hydrateTaskPageRows(transaction: DatabaseTransaction, pageRows: TaskPageKey[]) {
  const selectedIds = pageRows.map((row) => row.taskId);
  const taskRows = transaction.select().from(tasks).where(inArray(tasks.id, selectedIds)).all();
  const taskRowsById = new Map(taskRows.map((task) => [task.id, task]));
  const blockedIds = readBlockedTaskIds(transaction, selectedIds);
  const projectSlugs = [...new Set(taskRows.map((task) => task.projectSlug))];
  const configRows = transaction
    .select({ project: projects, config: projectConfigs })
    .from(projects)
    .leftJoin(
      projectConfigs,
      and(
        eq(projectConfigs.projectSlug, projects.slug),
        eq(projectConfigs.revision, projects.configRevision),
      ),
    )
    .where(inArray(projects.slug, projectSlugs))
    .all();
  const projectContexts = new Map(
    configRows.map((row) => [
      row.project.slug,
      { project: row.project, config: joinedConfiguration(row.config) },
    ]),
  );
  return pageRows.map((pageRow) => {
    const task = taskRowsById.get(pageRow.taskId);
    if (!task)
      throw domainError('INTERNAL_ERROR', 'A task disappeared from the current read snapshot');
    const context = projectContexts.get(task.projectSlug);
    if (!context)
      throw domainError('INTERNAL_ERROR', 'The current project configuration is unavailable');
    return {
      task: {
        ...taskResource(task, context.project, context.config, pageRow.displayDeadline),
        blocked: blockedIds.has(task.id),
      },
      ...context,
    };
  });
}
function materializedTaskPageRows(
  transaction: DatabaseTransaction,
  page: {
    input: z.output<typeof taskListInputSchema>;
    emojiKey: string | undefined;
    options: PageOptions;
    asOf: number;
    timezone: string;
    offset: number;
  },
) {
  // Category filters run against the materialized alias so workflow JSON is
  // decoded once per candidate and reused by both filtering and agenda order.
  const computedInput = { ...page.input, include_terminal: true, category: undefined };
  const computed = transaction
    .select({
      taskId: sql<string>`${tasks.id}`.as('task_id'),
      projectPriority: sql<number>`${projects.priority}`.as('project_priority'),
      projectSlug: sql<string>`${projects.slug}`.as('project_slug'),
      taskKind: sql<string>`${tasks.kind}`.as('task_kind'),
      category: taskCategory.as('task_category'),
      displayDeadline: effectiveTaskDeadline.as('display_deadline'),
      priorityUnset: taskPriorityUnset.as('priority_unset'),
      priorityRank: taskPriorityRank.as('priority_rank'),
      createdAt: sql<number>`${tasks.createdAt}`.as('created_at'),
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
    .where(taskPredicates(computedInput, page.emojiKey));
  const column = (name: string) => sql`${sql.identifier(name)}`;
  const deadline = column('display_deadline');
  const category = column('task_category');
  const kind = column('task_kind');
  const materializedFilters: (SQL | undefined)[] = [
    taskDeadlinePredicate(
      { input: page.input, asOf: page.asOf, timezone: page.timezone },
      { deadline, kind, category },
    ),
  ];
  if (!page.input.include_terminal)
    materializedFilters.push(
      sql`(${kind} != 'ordinary' OR ${category} NOT IN ('completed','cancelled'))`,
    );
  if (page.input.category !== undefined)
    materializedFilters.push(eq(category, page.input.category));
  const precedingOrder = page.options.precedingOrder?.(page.asOf, page.timezone, {
    deadline,
    kind,
    category,
  });
  const order = [
    desc(column('project_priority')),
    asc(column('project_slug')),
    ...(precedingOrder ?? []),
    asc(column('priority_unset')),
    asc(column('priority_rank')),
    asc(sql`CASE WHEN ${deadline} IS NULL THEN 1 ELSE 0 END`),
    asc(deadline),
    asc(column('created_at')),
    asc(column('task_id')),
  ];
  return transaction.all<TaskPageKey>(sql`
    WITH computed AS MATERIALIZED (${computed.getSQL()})
    SELECT ${column('task_id')} AS taskId, ${deadline} AS displayDeadline FROM computed
    WHERE ${and(...materializedFilters) ?? sql`1`}
    ORDER BY ${sql.join(order, sql`, `)}
    LIMIT ${page.input.limit + 1} OFFSET ${page.offset}
  `);
}
function columnOrderRevision(
  transaction: DatabaseTransaction,
  input: z.output<typeof taskListInputSchema>,
  board: boolean | undefined,
) {
  if (!board) return 1;
  if (input.project_slug === undefined || input.kind === undefined || input.status_id === undefined)
    throw domainError('VALIDATION_ERROR', 'Board reads require project, kind and status');
  return (
    transaction
      .select({ revision: boardColumns.revision })
      .from(boardColumns)
      .where(
        and(
          eq(boardColumns.projectSlug, input.project_slug),
          eq(boardColumns.kind, input.kind),
          eq(boardColumns.statusId, input.status_id),
        ),
      )
      .get()?.revision ?? 1
  );
}
function pageOrder({
  options,
  asOf,
  timezone,
}: {
  options: PageOptions;
  asOf: number;
  timezone: string;
}) {
  if (options.boardOrder)
    return [
      asc(sql`coalesce((SELECT ${boardOrder.position} FROM ${boardOrder}
    WHERE ${boardOrder.taskId} = ${tasks.id}), 9223372036854775807)`),
      asc(tasks.createdAt),
      asc(tasks.id),
    ];
  return [
    desc(projects.priority),
    asc(projects.slug),
    ...(options.precedingOrder?.(asOf, timezone, {
      deadline: effectiveTaskDeadline,
      kind: sql`${tasks.kind}`,
      category: taskCategory,
    }) ?? []),
    asc(taskPriorityUnset),
    asc(taskPriorityRank),
    asc(sql`CASE WHEN ${effectiveTaskDeadline} IS NULL THEN 1 ELSE 0 END`),
    asc(effectiveTaskDeadline),
    asc(tasks.createdAt),
    asc(tasks.id),
  ];
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
      order: options.boardOrder
        ? 'board_position_created_id_v1'
        : 'project_priority_model_deadline_created_id_v1',
    });
    const page = paginationContext({ state, query, now, cursor: parsed.cursor });
    // Keep the ordered query narrow. Project configuration contains several JSON
    // documents, and projecting it here would make Drizzle decode the same values
    // once for every task before the page can de-duplicate them.
    // Agenda benefits from computing its repeated deadline/category expressions
    // once; the simpler task and priority orders stay faster without materialization.
    const pageRows = options.materializeOrder
      ? materializedTaskPageRows(transaction, {
          input: parsed,
          emojiKey,
          options,
          asOf: page.asOf,
          timezone: state.timezone,
          offset: page.offset,
        })
      : transaction
          .select({
            taskId: tasks.id,
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
          .where(
            and(
              taskPredicates(parsed, emojiKey),
              taskDeadlinePredicate(
                { input: parsed, asOf: page.asOf, timezone: state.timezone },
                {
                  deadline: effectiveTaskDeadline,
                  kind: sql`${tasks.kind}`,
                  category: taskCategory,
                },
              ),
            ),
          )
          .orderBy(...pageOrder({ options, asOf: page.asOf, timezone: state.timezone }))
          .limit(parsed.limit + 1)
          .offset(page.offset)
          .all();
    const selectedPageRows = pageRows.slice(0, parsed.limit);
    const selected =
      selectedPageRows.length === 0 ? [] : hydrateTaskPageRows(transaction, selectedPageRows);
    return {
      rows: selected,
      nextCursor:
        pageRows.length > parsed.limit
          ? nextPageCursor({ state, query, asOf: page.asOf, offset: page.offset + selected.length })
          : null,
      meta: queryMetadata(state, now, page.asOf),
      asOf: page.asOf,
      timezone: state.timezone,
      orderRevision: columnOrderRevision(transaction, parsed, options.boardOrder),
    };
  });
}
export type TaskPageRow = ReturnType<typeof readTaskPage>['rows'][number];
