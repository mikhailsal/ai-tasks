import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { tasks } from '../../../schema/entities.js';
import { occurrences, recurrenceState, scheduleGenerations } from '../../../schema/recurrence.js';
import { hint } from '../../diagnostics/hints.js';
import type { DatabaseConnection } from '../../database/types.js';
import { workflows } from './workflows.js';
import { localTimeOf } from '../../recurrence/derive-local-time.js';
import type { AdvisoryProvider, AdvisoryRequest, Finding } from '../collect.js';

type Database = DatabaseConnection['db'];
const MAX_TASKS = 200;
/** Responses that show recurring tasks (spec 012 R1). */
const taskOperations = new Set([
  'task.create',
  'task.get',
  'task.list',
  'task.board',
  'task.transition',
  'task.move',
  'recurrence.get',
  'recurrence.configure',
  'recurrence.control',
  'priorities.list',
  'agenda.list',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Recurring task ids named in the response; their state is read fresh, not from the data. */
export function recurringTaskIds(data: unknown, found = new Set<string>()): Set<string> {
  if (found.size >= MAX_TASKS) return found;
  if (Array.isArray(data)) for (const item of data) recurringTaskIds(item, found);
  else if (isObject(data)) {
    if (data.kind === 'recurring' && typeof data.id === 'string') found.add(data.id);
    if (typeof data.task_id === 'string' && isObject(data.configuration)) found.add(data.task_id);
    for (const value of Object.values(data)) recurringTaskIds(value, found);
  }
  return found;
}

/** Rows of the named tasks; an all-projects read covers every project it lists. */
function draftFindings(database: Database, scope: string | null, ids: string[]): Finding[] {
  const workflowOf = workflows(database);
  const rows = database
    .select({
      id: tasks.id,
      projectSlug: tasks.projectSlug,
      statusId: tasks.statusId,
      archivedAt: tasks.archivedAt,
    })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), scope === null ? undefined : eq(tasks.projectSlug, scope)))
    .all();
  return rows.flatMap((row) => {
    const workflow = workflowOf(row.projectSlug);
    const category = new Map(workflow.statuses.map((status) => [status.id, status.category]));
    if (row.archivedAt !== null || category.get(row.statusId) !== 'draft') return [];
    const targets = workflow.transitions
      .filter((edge) => edge.from === row.statusId && category.get(edge.to) === 'active')
      .map((edge) => edge.to);
    const text = targets.length
      ? `Move it to an active status: ${targets.join(', ')}.`
      : 'No active status is reachable from this status; see config get.';
    return [
      {
        code: 'recurring_not_generating',
        remedy: hint('transition_task', text, { command: 'task transition' }),
        subject: { type: 'task', id: row.id },
      },
    ];
  });
}

/** Both times given and different, until the first occurrence is decided (spec 012 R3). */
function mismatchFindings(database: Database, scope: string | null, ids: string[]): Finding[] {
  const rows = database
    .select({ taskId: recurrenceState.taskId, generation: scheduleGenerations })
    .from(recurrenceState)
    .innerJoin(scheduleGenerations, eq(scheduleGenerations.id, recurrenceState.currentGenerationId))
    .where(
      and(
        inArray(recurrenceState.taskId, ids),
        scope === null ? undefined : eq(recurrenceState.projectSlug, scope),
      ),
    )
    .all();
  return rows.flatMap(({ taskId, generation }) => {
    const schedule = generation.schedule;
    if (!isObject(schedule) || typeof schedule.local_time !== 'string') return [];
    const first = localTimeOf(generation.firstDeadline, generation.timezone);
    if (first === schedule.local_time) return [];
    const decided = database
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(
        and(
          eq(occurrences.generationId, generation.id),
          eq(occurrences.deadline, generation.firstDeadline),
          notInArray(occurrences.state, ['pending']),
        ),
      )
      .get();
    if (decided) return [];
    return [
      {
        code: 'schedule_time_mismatch',
        remedy: hint(
          'review_schedule',
          `The first deadline is at ${first} local time; later occurrences use ${schedule.local_time}.`,
          { command: 'recurrence configure' },
        ),
        subject: { type: 'task', id: taskId },
      },
    ];
  });
}

/** `local_time` left out of a calendar schedule in this request (spec 012 R2). */
function omittedLocalTime(request: AdvisoryRequest): boolean {
  if (request.operation !== 'task.create' && request.operation !== 'recurrence.configure')
    return false;
  const body =
    isObject(request.input) && isObject(request.input.payload)
      ? request.input.payload
      : request.input;
  if (!isObject(body)) return false;
  const recurrence = isObject(body.recurrence) ? body.recurrence : body;
  const schedule = recurrence.schedule;
  return isObject(schedule) && schedule.mode === 'calendar' && !('local_time' in schedule);
}

function derivedFindings(database: Database, request: AdvisoryRequest, ids: string[]): Finding[] {
  if (!omittedLocalTime(request) || request.projectSlug === null) return [];
  const rows = database
    .select({ taskId: recurrenceState.taskId, schedule: scheduleGenerations.schedule })
    .from(recurrenceState)
    .innerJoin(scheduleGenerations, eq(scheduleGenerations.id, recurrenceState.currentGenerationId))
    .where(
      and(
        eq(recurrenceState.projectSlug, request.projectSlug),
        inArray(recurrenceState.taskId, ids),
      ),
    )
    .all();
  return rows.flatMap(({ taskId, schedule }) =>
    isObject(schedule) && typeof schedule.local_time === 'string'
      ? [
          {
            code: 'schedule_time_derived' as const,
            remedy: hint('no_action', `The schedule uses ${schedule.local_time} local time.`),
            subject: { type: 'task' as const, id: taskId },
          },
        ]
      : [],
  );
}

export const readinessProvider: AdvisoryProvider = (database, request) => {
  if (!taskOperations.has(request.operation)) return [];
  const ids = [...recurringTaskIds(request.data)];
  if (ids.length === 0) return [];
  return [
    ...draftFindings(database, request.projectSlug, ids),
    ...mismatchFindings(database, request.projectSlug, ids),
    ...derivedFindings(database, request, ids),
  ];
};
