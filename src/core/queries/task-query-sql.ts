import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod/mini';
import { toScaledPriority, type PriorityValue } from '../../schema/configuration.js';
import { projectConfigs, projects, tasks } from '../../schema/entities.js';
import { occurrences } from '../../schema/recurrence.js';
import { taskListInputSchema } from '../../schema/task-query.js';
import type { DatabaseConnection } from '../database/types.js';
export { taskListInputSchema };
// Keep the correlated subquery nested so Drizzle preserves its qualified outer
// task ID even when the expression is projected from a single-table detail query.
const earliestOpenDeadline = sql<
  number | null
>`(SELECT min(${occurrences.deadline}) FROM ${occurrences}
  WHERE ${occurrences.taskId} = ${tasks.id} AND ${occurrences.state} IN ('pending','debt'))`;
export const effectiveTaskDeadline = sql<number | null>`CASE WHEN ${tasks.kind} = 'ordinary'
  THEN ${tasks.deadline} ELSE ${earliestOpenDeadline} END`;
export const taskCategory = sql<string>`coalesce((SELECT json_extract(status.value, '$.category')
  FROM json_each(CASE WHEN ${tasks.kind} = 'ordinary' THEN ${projectConfigs.ordinaryWorkflow}
  ELSE ${projectConfigs.recurringWorkflow} END, '$.statuses') AS status
  WHERE json_extract(status.value, '$.id') = ${tasks.statusId} LIMIT 1), '')`;
export const taskPriorityUnset = sql<number>`CASE WHEN ${tasks.priority} IS NULL
  OR json_type(${tasks.priority}) = 'null' THEN 1 ELSE 0 END`;
export const taskPriorityRank = sql<
  number | null
>`CASE json_extract(${projectConfigs.priorityModel}, '$.type')
  WHEN 'classic' THEN CASE json_extract(${tasks.priority}, '$.level')
    WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
  WHEN 'eisenhower' THEN (CASE json_extract(${tasks.priority}, '$.important') WHEN 1 THEN 0 ELSE 2 END)
    + (CASE json_extract(${tasks.priority}, '$.urgent') WHEN 1 THEN 0 ELSE 1 END)
  WHEN 'named' THEN (SELECT level.key FROM json_each(${projectConfigs.priorityModel}, '$.levels') AS level
    WHERE json_extract(level.value, '$.id') = json_extract(${tasks.priority}, '$.level_id') LIMIT 1)
  WHEN 'numeric' THEN CASE json_extract(${projectConfigs.priorityModel}, '$.direction')
    WHEN 'higher' THEN -${tasks.priorityScaled} ELSE ${tasks.priorityScaled} END END`;
// SQLite's built-in lower() folds ASCII only. This deterministic, connection-local
// function keeps literal Russian/Unicode substring search inside the paginated SQL.
const searchConnections = new WeakSet<DatabaseConnection['sqlite']>();
export function registerTaskSearch(connection: DatabaseConnection): void {
  if (searchConnections.has(connection.sqlite)) return;
  connection.sqlite.function('ai_tasks_lower', { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? value.toLowerCase() : '',
  );
  searchConnections.add(connection.sqlite);
}
function priorityPredicate(priority: PriorityValue): SQL {
  if (priority === null)
    return sql`(${tasks.priority} IS NULL OR json_type(${tasks.priority}) = 'null')`;
  const model = sql`json_extract(${tasks.priority}, '$.model') = ${priority.model}`;
  if (priority.model === 'classic')
    return sql`${model} AND json_extract(${tasks.priority}, '$.level') = ${priority.level}`;
  if (priority.model === 'named')
    return sql`${model} AND json_extract(${tasks.priority}, '$.level_id') = ${priority.level_id}`;
  if (priority.model === 'numeric')
    return sql`${model} AND ${tasks.priorityScaled} = ${toScaledPriority(priority.value)}`;
  return sql`${model} AND json_extract(${tasks.priority}, '$.important') = ${Number(priority.important)}
    AND json_extract(${tasks.priority}, '$.urgent') = ${Number(priority.urgent)}`;
}
export function taskPredicates(
  input: z.output<typeof taskListInputSchema>,
  emojiKey: string | undefined,
): SQL | undefined {
  const filters: SQL[] = [];
  if (input.project_slug !== undefined) filters.push(eq(tasks.projectSlug, input.project_slug));
  if (input.archive === 'exclude')
    filters.push(sql`${tasks.archivedAt} IS NULL AND ${projects.archivedAt} IS NULL`);
  if (input.archive === 'only')
    filters.push(sql`(${tasks.archivedAt} IS NOT NULL OR ${projects.archivedAt} IS NOT NULL)`);
  if (!input.include_terminal)
    filters.push(
      sql`(${tasks.kind} != 'ordinary' OR ${taskCategory} NOT IN ('completed','cancelled'))`,
    );
  if (input.kind !== undefined) filters.push(eq(tasks.kind, input.kind));
  if (input.status_id !== undefined) filters.push(eq(tasks.statusId, input.status_id));
  if (input.category !== undefined) filters.push(sql`${taskCategory} = ${input.category}`);
  if (emojiKey !== undefined) filters.push(eq(tasks.emojiKey, emojiKey));
  if (input.priority !== undefined) filters.push(priorityPredicate(input.priority));
  if (input.q !== undefined)
    filters.push(sql`(instr(ai_tasks_lower(${tasks.title}), ${input.q.toLowerCase()}) > 0
    OR instr(ai_tasks_lower(${tasks.description}), ${input.q.toLowerCase()}) > 0)`);
  return and(...filters);
}
