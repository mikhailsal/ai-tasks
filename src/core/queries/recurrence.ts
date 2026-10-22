import { and, asc, count, eq, min } from 'drizzle-orm';
import { occurrences } from '../../schema/recurrence.js';
import {
  occurrenceEnvelopeSchema,
  occurrenceListInputSchema,
  occurrencePageEnvelopeSchema,
  occurrenceResourceSchema,
  recurrenceEnvelopeSchema,
  recurrenceResourceSchema,
  type OccurrenceListInput,
} from '../../schema/recurrence-query.js';
import { uuidSchema } from '../../schema/values.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { readProjectConfiguration, requireProject } from '../projects/read.js';
import { currentRecurrence, requireRecurring } from '../recurrence/generations.js';
import { occurrenceResource, type OccurrenceRow } from '../recurrence/snapshots.js';
import { taskStatus } from '../tasks/read.js';
import { formatTimestamp, readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { queryFingerprint } from './cursor.js';
import { nextPageCursor, paginationContext, queryMetadata, queryState } from './page.js';

type ReadContext = Pick<CoreContext, 'connection' | 'now'>;
const nullableTime = (value: number | null) => (value === null ? null : formatTimestamp(value));
function parentContext(transaction: DatabaseTransaction, slug: string, id: string) {
  const project = requireProject(transaction, slug);
  const task = requireRecurring(transaction, slug, id);
  return { project, task };
}
function frozenResource(row: OccurrenceRow) {
  try {
    return occurrenceResourceSchema.parse(occurrenceResource(row));
  } catch {
    throw domainError('INTERNAL_ERROR', 'The stored occurrence resource is invalid');
  }
}

export function getRecurrence(context: ReadContext, projectSlug: string, taskId: string) {
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    const { project, task } = parentContext(transaction, projectSlug, taskId);
    const config = readProjectConfiguration(transaction, project);
    const current = currentRecurrence(transaction, task);
    const groups = transaction
      .select({ state: occurrences.state, count: count(), deadline: min(occurrences.deadline) })
      .from(occurrences)
      .where(and(eq(occurrences.projectSlug, projectSlug), eq(occurrences.taskId, taskId)))
      .groupBy(occurrences.state)
      .all();
    const counts = {
      pending: 0,
      debt: 0,
      missed: 0,
      completed: 0,
      completed_late: 0,
      cancelled: 0,
      total: 0,
    };
    let deadline: number | null = null;
    for (const group of groups) {
      counts[group.state] = group.count;
      counts.total += group.count;
      if ((group.state === 'pending' || group.state === 'debt') && group.deadline !== null)
        deadline = deadline === null ? group.deadline : Math.min(deadline, group.deadline);
    }
    const generation = current.generation;
    const resource = recurrenceResourceSchema.safeParse({
      task_id: task.id,
      project_slug: task.projectSlug,
      task_revision: task.revision,
      config_revision: project.configRevision,
      settings_revision: state.revision,
      status_id: task.statusId,
      category: taskStatus(task, config).category,
      archived_at: nullableTime(task.archivedAt),
      display_deadline: nullableTime(deadline),
      configuration: {
        generation_id: generation.id,
        generation_number: generation.generationNumber,
        first_deadline: formatTimestamp(generation.firstDeadline),
        schedule: current.schedule,
        timezone: generation.timezone,
        miss_policy: generation.missPolicy,
        confirmation_window_ms: generation.windowMs,
      },
      checkpoint: {
        revision: current.state.revision,
        cursor_anchor: nullableTime(current.state.cursorAnchor),
        next_candidate_at: nullableTime(current.state.nextCandidateAt),
        waiting_predecessor_id: current.state.waitingPredecessorId,
      },
      occurrences: counts,
    });
    if (!resource.success)
      throw domainError('INTERNAL_ERROR', 'The stored recurrence resource is invalid');
    return recurrenceEnvelopeSchema.parse({
      ok: true,
      data: resource.data,
      meta: queryMetadata(state, now),
    });
  });
}

export function listOccurrences(
  context: ReadContext,
  projectSlug: string,
  taskId: string,
  input: OccurrenceListInput = {},
) {
  const parsed = parseInput(occurrenceListInputSchema, input);
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    parentContext(transaction, projectSlug, taskId);
    const query = queryFingerprint({
      kind: 'occurrences',
      project_slug: projectSlug,
      task_id: taskId,
      ...parsed,
      cursor: undefined,
      order: 'deadline_asc_id_asc_v1',
    });
    const page = paginationContext({ state, query, now, cursor: parsed.cursor });
    const rows = transaction
      .select()
      .from(occurrences)
      .where(
        and(
          eq(occurrences.projectSlug, projectSlug),
          eq(occurrences.taskId, taskId),
          parsed.state === undefined ? undefined : eq(occurrences.state, parsed.state),
        ),
      )
      .orderBy(asc(occurrences.deadline), asc(occurrences.id))
      .limit(parsed.limit + 1)
      .offset(page.offset)
      .all();
    const items = rows.slice(0, parsed.limit).map(frozenResource);
    return occurrencePageEnvelopeSchema.parse({
      ok: true,
      data: {
        items,
        next_cursor:
          rows.length > parsed.limit
            ? nextPageCursor({ state, query, asOf: page.asOf, offset: page.offset + items.length })
            : null,
      },
      meta: queryMetadata(state, now, page.asOf),
    });
  });
}

export function getOccurrence(
  context: ReadContext,
  projectSlug: string,
  taskId: string,
  occurrenceId: string,
) {
  parseInput(uuidSchema, occurrenceId);
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    parentContext(transaction, projectSlug, taskId);
    const row = transaction
      .select()
      .from(occurrences)
      .where(eq(occurrences.id, occurrenceId))
      .get();
    if (!row)
      throw domainError('TASK_NOT_FOUND', 'The requested occurrence does not exist', {
        resource: 'occurrence',
        entity_id: occurrenceId,
      });
    if (row.taskId !== taskId || row.projectSlug !== projectSlug)
      throw domainError('PROJECT_MISMATCH', 'The occurrence belongs to another parent or project', {
        entity_id: occurrenceId,
      });
    return occurrenceEnvelopeSchema.parse({
      ok: true,
      data: frozenResource(row),
      meta: queryMetadata(state, now),
    });
  });
}
