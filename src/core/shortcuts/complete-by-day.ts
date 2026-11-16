import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import * as z from 'zod/mini';
import { dayStringSchema } from '../../schema/occurrence-values.js';
import { outcomeTextSchema } from '../../schema/recurrence-input.js';
import { occurrences } from '../../schema/recurrence.js';
import { timestampSchema, uuidSchema } from '../../schema/values.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { executeShortcut, type Resolution } from '../database/shortcut.js';
import { domainError } from '../errors.js';
import { requireProject } from '../projects/read.js';
import { applyCompletion } from '../recurrence/complete.js';
import { occurrenceResource, type OccurrenceRow } from '../recurrence/snapshots.js';
import { parseTimestamp } from '../time.js';
import { parseInput } from '../validation.js';
import { nameTask } from './name-task.js';
import { strictTokens } from './tokens.js';

const MAX_CANDIDATES = 10;
export const occurrenceDoneSchema = z
  .strictObject({
    task: z.string().check(z.minLength(1)),
    day: z.optional(dayStringSchema),
    occurrence: z.optional(uuidSchema),
    at: z.optional(timestampSchema),
    note: z.optional(outcomeTextSchema),
  })
  .check(
    z.refine(
      (input) => (input.day === undefined) !== (input.occurrence === undefined),
      'Name the occurrence by --day or by --occurrence, not both',
    ),
  );
export type OccurrenceDoneInput = z.infer<typeof occurrenceDoneSchema>;

function nearestDays(transaction: DatabaseTransaction, taskId: string, day: string) {
  const near = (before: boolean) =>
    transaction
      .select({ day: occurrences.occurrenceDay })
      .from(occurrences)
      .where(
        and(
          eq(occurrences.taskId, taskId),
          before ? lt(occurrences.occurrenceDay, day) : gt(occurrences.occurrenceDay, day),
        ),
      )
      .orderBy(before ? desc(occurrences.occurrenceDay) : asc(occurrences.occurrenceDay))
      .limit(1)
      .get()?.day ?? null;
  return { earlier: near(true), later: near(false) };
}

/** The one occurrence the agent named; none or several are refused with what to try next. */
function findOccurrence(
  transaction: DatabaseTransaction,
  taskId: string,
  input: OccurrenceDoneInput,
): OccurrenceRow {
  const where =
    input.occurrence === undefined
      ? eq(occurrences.occurrenceDay, input.day ?? '')
      : eq(occurrences.id, input.occurrence);
  const rows = transaction
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.taskId, taskId), where))
    .orderBy(asc(occurrences.deadline), asc(occurrences.id))
    .all();
  const open = rows.filter((row) => row.state !== 'cancelled');
  const matches = open.length > 0 ? open : rows;
  const [first] = matches;
  if (!first)
    throw domainError(
      'TASK_NOT_FOUND',
      input.occurrence === undefined
        ? `The task has no occurrence on ${String(input.day)}`
        : 'The task has no such occurrence',
      input.occurrence === undefined
        ? {
            resource: 'occurrence',
            nearest_days: nearestDays(transaction, taskId, input.day ?? ''),
          }
        : { resource: 'occurrence', entity_id: input.occurrence },
    );
  if (matches.length > 1)
    throw domainError(
      'VALIDATION_ERROR',
      `${String(matches.length)} occurrences fall on ${String(input.day)}; name one with --occurrence`,
      {
        field: 'day',
        candidates: matches.slice(0, MAX_CANDIDATES).map((row) => ({
          id: row.id,
          state: row.state,
          deadline: new Date(row.deadline).toISOString(),
        })),
      },
    );
  return first;
}

/** Repeat safety by state (R2): the same completion again is returned, a different one refused. */
function alreadyDone(row: OccurrenceRow, input: OccurrenceDoneInput): Resolution | undefined {
  if (row.state !== 'completed' && row.state !== 'completed_late') return undefined;
  const sameTime = input.at === undefined || parseTimestamp(input.at) === row.actualCompletedAt;
  const sameNote = input.note === undefined || input.note === row.completionNote;
  const resource = occurrenceResource(row);
  if (sameTime && sameNote) return { kind: 'existing', data: resource };
  throw domainError(
    'VALIDATION_ERROR',
    'The occurrence is already completed with a different time or note; nothing was changed',
    { entity_id: row.id, state: row.state, existing: resource },
  );
}

/** `occurrence done` (spec 009 US1): the strict `occurrence complete` with one item. */
export function completeByDay(context: CoreContext, projectSlug: string, raw: unknown) {
  const input = parseInput(occurrenceDoneSchema, raw);
  return executeShortcut({
    context,
    operation: 'occurrence.complete',
    projectSlug,
    resolve(transaction) {
      const project = requireProject(transaction, projectSlug);
      const task = nameTask(transaction, projectSlug, input.task);
      if (task.kind !== 'recurring')
        throw domainError(
          'VALIDATION_ERROR',
          `The task is ${task.kind}; occurrence done needs a recurring task. Use task move for ordinary tasks`,
          { entity_id: task.id, kind: task.kind },
        );
      const row = findOccurrence(transaction, task.id, input);
      const existing = alreadyDone(row, input);
      if (existing) return existing;
      return {
        kind: 'write',
        tokens: strictTokens(transaction, 'occurrence.complete', { task, project }),
        payload: {
          occurrences: [
            {
              id: row.id,
              expected_revision: row.revision,
              ...(input.at === undefined ? {} : { actual_completed_at: input.at }),
              ...(input.note === undefined ? {} : { note: input.note }),
            },
          ],
        },
        guards: { entity: { type: 'task', id: task.id } },
        handler: (envelope) => (tx, now) =>
          applyCompletion(tx, { projectSlug, taskId: task.id, input: envelope, now }),
      };
    },
  });
}
