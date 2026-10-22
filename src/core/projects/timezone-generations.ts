import { Temporal } from '@js-temporal/polyfill';
import { and, asc, eq, gt, max } from 'drizzle-orm';
import { projects, tasks } from '../../schema/entities.js';
import { occurrences, recurrenceState, scheduleGenerations } from '../../schema/recurrence.js';
import { jsonValueSchema } from '../../schema/values.js';
import type { AuditEvent } from '../audit/append.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { advanceCalendar } from '../recurrence/calendar-enumeration.js';
import { nextCalendarDeadline } from '../recurrence/calendar.js';
import { recurrenceConfiguration } from '../recurrence/control.js';
import {
  currentRecurrence,
  publishGeneration,
  setRecurrenceBehavior,
  type RecurringTask,
} from '../recurrence/generations.js';
import { reconcileBeforeGenerationChange } from '../recurrence/retirement.js';
import { futureCalendarCandidate } from '../recurrence/resume.js';
import { taskStatus } from '../tasks/read.js';
import { formatTimestamp, readClock } from '../time.js';
import { readProjectConfiguration } from './read.js';

type ZoneChange = { timezone: string; now: number };

function continuation(
  current: ReturnType<typeof currentRecurrence>,
  options: ZoneChange & { materializedHorizon: number | null },
) {
  const { state, generation, schedule } = current;
  if (schedule.mode !== 'calendar')
    throw domainError('INTERNAL_ERROR', 'Timezone continuation requires a calendar rule');
  const floor = Math.max(
    options.now,
    state.cursorAnchor ?? options.now,
    options.materializedHorizon ?? options.now,
  );
  // The unresolved candidate carries cadence; cursor may only be an effective-time floor.
  const unresolved =
    state.nextCandidateAt ??
    (state.cursorAnchor === null
      ? generation.firstDeadline
      : nextCalendarDeadline({
          schedule,
          anchor: state.cursorAnchor,
          timezone: generation.timezone,
        }));
  const candidate = Temporal.Instant.fromEpochMilliseconds(unresolved)
    .toZonedDateTimeISO(generation.timezone)
    .toPlainDate()
    .toPlainDateTime(Temporal.PlainTime.from(schedule.local_time))
    .toZonedDateTime(options.timezone, { disambiguation: 'compatible' }).epochMilliseconds;
  const future = futureCalendarCandidate({
    schedule,
    timezone: options.timezone,
    candidate,
    now: floor,
  });
  readClock(() => future + generation.windowMs);
  nextCalendarDeadline({ schedule, anchor: future, timezone: options.timezone });
  return { floor, future };
}

function versionParent(
  transaction: DatabaseTransaction,
  options: ZoneChange & {
    task: RecurringTask;
    project: typeof projects.$inferSelect;
    limit: number;
  },
) {
  const { task, project, now, timezone } = options;
  const config = readProjectConfiguration(transaction, project);
  const category = taskStatus(task, config).category;
  const drained = reconcileBeforeGenerationChange(transaction, {
    task,
    now,
    limit: options.limit,
    includeEffectiveAnchor: true,
  });
  const current = currentRecurrence(transaction, task);
  const materializedHorizon =
    transaction
      .select({ deadline: max(occurrences.deadline) })
      .from(occurrences)
      .where(eq(occurrences.taskId, task.id))
      .get()?.deadline ?? null;
  const next = continuation(current, { ...options, materializedHorizon });
  const generation = publishGeneration(transaction, {
    task,
    now,
    timezone,
    entry: 'timezone',
    continuationAnchor: next.floor,
    nextCandidate: next.future,
    input: {
      schedule: current.schedule,
      first_deadline: formatTimestamp(current.generation.firstDeadline),
      miss_policy: current.generation.missPolicy,
      confirmation_window_ms: current.generation.windowMs,
    },
  });
  const behavior = project.archivedAt !== null || task.archivedAt !== null ? 'archived' : category;
  if (!['draft', 'active', 'paused', 'archived'].includes(behavior))
    throw domainError('INTERNAL_ERROR', 'A recurring task has invalid lifecycle behavior');
  const recurringBehavior =
    behavior === 'active' || behavior === 'draft' || behavior === 'archived' ? behavior : 'paused';
  setRecurrenceBehavior(transaction, {
    task,
    generationId: generation.id,
    behavior: recurringBehavior,
    now,
  });
  const created = behavior === 'active' ? advanceCalendar(transaction, { task, now }).events : [];
  transaction
    .update(tasks)
    .set({ revision: task.revision + 1, updatedAt: now })
    .where(eq(tasks.id, task.id))
    .run();
  const events: AuditEvent[] = [
    ...drained.events,
    ...created,
    {
      entity_type: 'task',
      entity_id: task.id,
      action: 'recurrence.timezone',
      changes: [
        {
          field: 'recurrence',
          before: recurrenceConfiguration(current.generation),
          after: recurrenceConfiguration(generation),
        },
        { field: 'revision', before: task.revision, after: task.revision + 1 },
      ],
      config_snapshot: jsonValueSchema.parse({ revision: project.configRevision, ...config }),
    },
  ];
  return { events, processed: drained.processed };
}

function calendarParentPage(transaction: DatabaseTransaction, after: string | undefined) {
  return transaction
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.slug, tasks.projectSlug))
    .innerJoin(recurrenceState, eq(recurrenceState.taskId, tasks.id))
    .innerJoin(scheduleGenerations, eq(scheduleGenerations.id, recurrenceState.currentGenerationId))
    .where(
      and(
        eq(tasks.kind, 'recurring'),
        eq(scheduleGenerations.mode, 'calendar'),
        after === undefined ? undefined : gt(tasks.id, after),
      ),
    )
    .orderBy(asc(tasks.id))
    .limit(32)
    .all();
}

/** Keyset pages bound full descriptions while preserving one global atomic mutation. */
export function versionCalendarTimezones(
  transaction: DatabaseTransaction,
  options: ZoneChange,
): AuditEvent[] {
  const events: AuditEvent[] = [];
  let remaining = 128;
  let after: string | undefined;
  while (true) {
    const parents = calendarParentPage(transaction, after);
    if (parents.length === 0) break;
    for (const parent of parents) {
      const result = versionParent(transaction, { ...options, ...parent, limit: remaining });
      remaining -= result.processed;
      events.push(...result.events);
    }
    after = parents.at(-1)?.task.id;
  }
  return events;
}
