import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';
import {
  integerConstraint,
  jsonConstraint,
  positiveInteger,
  uuidConstraint,
} from './constraints.js';
import { tasks } from './entities.js';
import type { JsonValue } from './values.js';

const missPolicies = ['carry_forward', 'record_miss'] as const;
const occurrenceStates = [
  'pending',
  'completed',
  'completed_late',
  'debt',
  'missed',
  'cancelled',
] as const;

export const scheduleGenerations = sqliteTable(
  'schedule_generations',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    projectSlug: text('project_slug').notNull(),
    taskKind: text('task_kind', { enum: ['recurring'] })
      .notNull()
      .default('recurring'),
    generationNumber: integer('generation_number').notNull(),
    mode: text('mode', { enum: ['calendar', 'after_completion'] }).notNull(),
    schedule: text('schedule', { mode: 'json' }).$type<JsonValue>().notNull(),
    firstDeadline: integer('first_deadline').notNull(),
    timezone: text('timezone').notNull(),
    missPolicy: text('miss_policy', { enum: missPolicies }).notNull(),
    windowMs: integer('window_ms').notNull(),
    createdAt: integer('created_at').notNull(),
    successorGenerationId: text('successor_generation_id'),
  },
  (table) => [
    unique('generation_parent_number_unique').on(table.taskId, table.generationNumber),
    unique('generation_owned_id_unique').on(table.projectSlug, table.taskId, table.id),
    foreignKey({
      columns: [table.projectSlug, table.taskId, table.taskKind],
      foreignColumns: [tasks.projectSlug, tasks.id, tasks.kind],
    }),
    foreignKey({
      columns: [table.projectSlug, table.taskId, table.successorGenerationId],
      foreignColumns: [table.projectSlug, table.taskId, table.id],
    }),
    check('generation_id_uuid', uuidConstraint(table.id)),
    check('generation_task_uuid', uuidConstraint(table.taskId)),
    check(
      'generation_successor_uuid',
      sql`${table.successorGenerationId} IS NULL OR ${uuidConstraint(table.successorGenerationId)}`,
    ),
    check('generation_positive_number', positiveInteger(table.generationNumber)),
    check('generation_recurring_parent', sql`${table.taskKind} = 'recurring'`),
    check('generation_valid_mode', sql`${table.mode} IN ('calendar', 'after_completion')`),
    check('generation_valid_schedule', jsonConstraint(table.schedule)),
    check('generation_valid_policy', sql`${table.missPolicy} IN ('carry_forward', 'record_miss')`),
    check(
      'generation_valid_window',
      sql`${integerConstraint(table.windowMs)} AND ${table.windowMs} BETWEEN 0 AND 2592000000`,
    ),
    check(
      'generation_integer_times',
      sql`${integerConstraint(table.firstDeadline)} AND ${integerConstraint(table.createdAt)}`,
    ),
  ],
);

export const occurrences = sqliteTable(
  'occurrences',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    projectSlug: text('project_slug').notNull(),
    generationId: text('generation_id').notNull(),
    occurrenceKey: text('occurrence_key').notNull(),
    deadline: integer('deadline').notNull(),
    expiresAt: integer('expires_at').notNull(),
    scheduleSnapshot: text('schedule_snapshot', { mode: 'json' }).$type<JsonValue>().notNull(),
    missPolicy: text('miss_policy', { enum: missPolicies }).notNull(),
    confirmationWindowMs: integer('confirmation_window_ms').notNull(),
    descriptionSnapshot: text('description_snapshot').notNull(),
    descriptionHtmlSnapshot: text('description_html_snapshot').notNull(),
    renderPolicyVersion: integer('render_policy_version').notNull(),
    state: text('state', { enum: occurrenceStates }).notNull(),
    revision: integer('revision').notNull().default(1),
    actualCompletedAt: integer('actual_completed_at'),
    completionRecordedAt: integer('completion_recorded_at'),
    missedAt: integer('missed_at'),
    cancelledAt: integer('cancelled_at'),
    cancelReason: text('cancel_reason'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    unique('occurrence_generation_key_unique').on(table.generationId, table.occurrenceKey),
    unique('occurrence_owned_id_unique').on(table.projectSlug, table.taskId, table.id),
    foreignKey({
      columns: [table.projectSlug, table.taskId, table.generationId],
      foreignColumns: [
        scheduleGenerations.projectSlug,
        scheduleGenerations.taskId,
        scheduleGenerations.id,
      ],
    }),
    check('occurrence_id_uuid', uuidConstraint(table.id)),
    check('occurrence_task_uuid', uuidConstraint(table.taskId)),
    check('occurrence_generation_uuid', uuidConstraint(table.generationId)),
    check('occurrence_nonempty_key', sql`length(${table.occurrenceKey}) > 0`),
    check('occurrence_positive_revision', positiveInteger(table.revision)),
    check('occurrence_positive_render_policy', positiveInteger(table.renderPolicyVersion)),
    check('occurrence_valid_schedule', jsonConstraint(table.scheduleSnapshot)),
    check('occurrence_valid_policy', sql`${table.missPolicy} IN ('carry_forward', 'record_miss')`),
    check(
      'occurrence_valid_window',
      sql`${integerConstraint(table.confirmationWindowMs)} AND ${table.confirmationWindowMs} BETWEEN 0 AND 2592000000`,
    ),
    check(
      'occurrence_valid_state',
      sql`${table.state} IN ('pending','completed','completed_late','debt','missed','cancelled')`,
    ),
    check(
      'occurrence_expiry_endpoint',
      sql`${table.expiresAt} = ${table.deadline} + ${table.confirmationWindowMs}`,
    ),
    check(
      'occurrence_integer_times',
      sql`${integerConstraint(table.deadline)} AND ${integerConstraint(table.expiresAt)} AND ${integerConstraint(table.createdAt)}`,
    ),
    check(
      'occurrence_nullable_times',
      sql`
    (${table.actualCompletedAt} IS NULL OR ${integerConstraint(table.actualCompletedAt)}) AND
    (${table.completionRecordedAt} IS NULL OR ${integerConstraint(table.completionRecordedAt)}) AND
    (${table.missedAt} IS NULL OR ${integerConstraint(table.missedAt)}) AND
    (${table.cancelledAt} IS NULL OR ${integerConstraint(table.cancelledAt)})`,
    ),
    check(
      'occurrence_completion_fields',
      sql`(${table.state} IN ('completed','completed_late') AND ${table.actualCompletedAt} IS NOT NULL AND ${table.completionRecordedAt} IS NOT NULL) OR (${table.state} NOT IN ('completed','completed_late') AND ${table.actualCompletedAt} IS NULL AND ${table.completionRecordedAt} IS NULL)`,
    ),
    check(
      'occurrence_miss_fields',
      sql`(${table.state} IN ('debt','missed','completed_late') AND ${table.missedAt} IS NOT NULL) OR (${table.state} NOT IN ('debt','missed','completed_late') AND ${table.missedAt} IS NULL)`,
    ),
    check(
      'occurrence_cancel_fields',
      sql`(${table.state} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL AND ${table.cancelReason} IS NOT NULL AND length(trim(${table.cancelReason})) > 0) OR (${table.state} != 'cancelled' AND ${table.cancelledAt} IS NULL AND ${table.cancelReason} IS NULL)`,
    ),
    index('occurrences_task_state_deadline_idx').on(
      table.taskId,
      table.state,
      table.deadline,
      table.id,
    ),
    index('occurrences_state_deadline_idx').on(table.state, table.deadline, table.id),
    index('occurrences_expiry_idx').on(table.state, table.expiresAt, table.id),
  ],
);

export const recurrenceState = sqliteTable(
  'recurrence_state',
  {
    taskId: text('task_id').notNull(),
    projectSlug: text('project_slug').notNull(),
    currentGenerationId: text('current_generation_id').notNull(),
    cursorAnchor: integer('cursor_anchor'),
    waitingPredecessorId: text('waiting_predecessor_id'),
    nextCandidateAt: integer('next_candidate_at'),
    revision: integer('revision').notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.projectSlug, table.taskId] }),
    foreignKey({
      columns: [table.projectSlug, table.taskId],
      foreignColumns: [tasks.projectSlug, tasks.id],
    }),
    foreignKey({
      columns: [table.projectSlug, table.taskId, table.currentGenerationId],
      foreignColumns: [
        scheduleGenerations.projectSlug,
        scheduleGenerations.taskId,
        scheduleGenerations.id,
      ],
    }),
    foreignKey({
      columns: [table.projectSlug, table.taskId, table.waitingPredecessorId],
      foreignColumns: [occurrences.projectSlug, occurrences.taskId, occurrences.id],
    }),
    check('recurrence_state_task_uuid', uuidConstraint(table.taskId)),
    check('recurrence_state_generation_uuid', uuidConstraint(table.currentGenerationId)),
    check(
      'recurrence_state_predecessor_uuid',
      sql`${table.waitingPredecessorId} IS NULL OR ${uuidConstraint(table.waitingPredecessorId)}`,
    ),
    check('recurrence_state_revision', positiveInteger(table.revision)),
    check(
      'recurrence_state_cursor_integer',
      sql`${table.cursorAnchor} IS NULL OR ${integerConstraint(table.cursorAnchor)}`,
    ),
    check(
      'recurrence_state_candidate_integer',
      sql`${table.nextCandidateAt} IS NULL OR ${integerConstraint(table.nextCandidateAt)}`,
    ),
    index('recurrence_candidate_idx').on(table.nextCandidateAt, table.projectSlug, table.taskId),
  ],
);

export const recurrenceIntervals = sqliteTable(
  'recurrence_intervals',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    projectSlug: text('project_slug').notNull(),
    startAt: integer('start_at').notNull(),
    endAt: integer('end_at'),
    behavior: text('behavior', { enum: ['active', 'paused', 'archived'] }).notNull(),
    scheduleGenerationId: text('schedule_generation_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectSlug, table.taskId],
      foreignColumns: [tasks.projectSlug, tasks.id],
    }),
    foreignKey({
      columns: [table.projectSlug, table.taskId, table.scheduleGenerationId],
      foreignColumns: [
        scheduleGenerations.projectSlug,
        scheduleGenerations.taskId,
        scheduleGenerations.id,
      ],
    }),
    check('recurrence_interval_id_uuid', uuidConstraint(table.id)),
    check('recurrence_interval_task_uuid', uuidConstraint(table.taskId)),
    check('recurrence_interval_generation_uuid', uuidConstraint(table.scheduleGenerationId)),
    check('recurrence_interval_start_integer', integerConstraint(table.startAt)),
    check(
      'recurrence_interval_end_integer',
      sql`${table.endAt} IS NULL OR ${integerConstraint(table.endAt)}`,
    ),
    check(
      'recurrence_interval_half_open',
      sql`${table.endAt} IS NULL OR ${table.endAt} >= ${table.startAt}`,
    ),
    check('recurrence_interval_behavior', sql`${table.behavior} IN ('active','paused','archived')`),
    index('recurrence_intervals_parent_start_idx').on(
      table.projectSlug,
      table.taskId,
      table.startAt,
    ),
  ],
);
