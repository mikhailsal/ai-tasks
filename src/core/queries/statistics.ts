import { and, asc, desc, eq } from 'drizzle-orm';
import type { z } from 'zod/mini';
import { priorityModelSchema } from '../../schema/configuration.js';
import { projectConfigs, projects, tasks } from '../../schema/entities.js';
import { occurrences } from '../../schema/recurrence.js';
import { statisticsEnvelopeSchema, statisticsInputSchema } from '../../schema/read-views.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { requireProject } from '../projects/read.js';
import { normalizeEmoji } from '../tasks/emoji.js';
import { formatTimestamp, readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { queryMetadata, queryState } from './page.js';
import { registerTaskSearch } from './task-query-sql.js';
import { emptyStatistics, totalStatistics } from './statistics-counters.js';
import {
  occurrenceStatisticsSelection,
  statisticsPredicates,
  taskStatisticsSelection,
  type StatisticsInput,
} from './statistics-sql.js';
const currentConfiguration = and(
  eq(projectConfigs.projectSlug, projects.slug),
  eq(projectConfigs.revision, projects.configRevision),
);
function occurrenceGroups(
  transaction: DatabaseTransaction,
  input: StatisticsInput,
  emoji: string | undefined,
) {
  return transaction
    .select({ projectSlug: projects.slug, counters: occurrenceStatisticsSelection(input) })
    .from(occurrences)
    .innerJoin(tasks, eq(occurrences.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectSlug, projects.slug))
    .leftJoin(projectConfigs, currentConfiguration)
    .where(statisticsPredicates(input, emoji))
    .groupBy(projects.slug)
    .all();
}
/** Metrics apply their own timestamp bounds; parent inventory never prefilters completion outcomes. */
export function getStatistics(
  context: Pick<CoreContext, 'connection' | 'now'>,
  input: z.input<typeof statisticsInputSchema>,
) {
  const parsed = parseInput(statisticsInputSchema, input);
  const emoji = parsed.emoji === undefined ? undefined : normalizeEmoji(parsed.emoji).key;
  registerTaskSearch(context.connection);
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    if (parsed.project_slug !== undefined) requireProject(transaction, parsed.project_slug);
    const rows = transaction
      .select({
        project: projects,
        priorityModel: projectConfigs.priorityModel,
        ...taskStatisticsSelection(parsed, now),
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectSlug, projects.slug))
      .leftJoin(projectConfigs, currentConfiguration)
      .where(statisticsPredicates(parsed, emoji))
      .groupBy(projects.slug)
      .orderBy(desc(projects.priority), asc(projects.slug))
      .all();
    const outcomes = new Map(
      occurrenceGroups(transaction, parsed, emoji).map((row) => [row.projectSlug, row.counters]),
    );
    const groups = rows.map((row) => {
      const model = priorityModelSchema.safeParse(row.priorityModel);
      if (!model.success)
        throw domainError('INTERNAL_ERROR', 'The stored project priority model is invalid');
      return {
        project: {
          slug: row.project.slug,
          name: row.project.name,
          emoji: row.project.emoji,
          priority: row.project.priority,
          config_revision: row.project.configRevision,
          archived_at:
            row.project.archivedAt === null ? null : formatTimestamp(row.project.archivedAt),
        },
        priority_model: model.data,
        tasks: { total: row.taskTotal, by_kind: row.byKind, by_category: row.byCategory },
        ordinary: row.ordinary,
        occurrences: outcomes.get(row.project.slug) ?? emptyStatistics().occurrences,
      };
    });
    return statisticsEnvelopeSchema.parse({
      ok: true,
      data: { ...totalStatistics(groups), groups },
      meta: queryMetadata(state, now, now),
    });
  });
}
