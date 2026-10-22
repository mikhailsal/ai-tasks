import { desc, sql } from 'drizzle-orm';
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
  slugConstraint,
  uuidConstraint,
} from './constraints.js';
import type { JsonValue } from './values.js';

export const applicationState = sqliteTable(
  'application_state',
  {
    id: integer('id').primaryKey().default(1),
    databaseEpoch: text('database_epoch').notNull(),
    timezone: text('timezone').notNull().default('Europe/Moscow'),
    revision: integer('revision').notNull().default(1),
    readRevision: integer('read_revision').notNull().default(1),
    schemaVersion: integer('schema_version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('application_singleton', sql`${table.id} = 1`),
    check('application_epoch_uuid', uuidConstraint(table.databaseEpoch)),
    check('application_revision_positive', positiveInteger(table.revision)),
    check('application_read_revision_positive', positiveInteger(table.readRevision)),
    check('application_schema_version', sql`${table.schemaVersion} = 1`),
    check('application_created_integer', integerConstraint(table.createdAt)),
    check('application_updated_integer', integerConstraint(table.updatedAt)),
  ],
);

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    emoji: text('emoji').notNull(),
    emojiKey: text('emoji_key').notNull().unique(),
    priority: integer('priority').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    configRevision: integer('config_revision').notNull().default(1),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('project_id_uuid', uuidConstraint(table.id)),
    check('project_slug_valid', slugConstraint(table.slug)),
    check(
      'project_name_length',
      sql`length(${table.name}) BETWEEN 1 AND 80 AND length(trim(${table.name})) > 0`,
    ),
    check('project_description_length', sql`length(${table.description}) <= 100000`),
    check(
      'project_emoji_nondefault',
      sql`length(${table.emojiKey}) > 0 AND ${table.emojiKey} != '⚪'`,
    ),
    check(
      'project_priority_int32',
      sql`${integerConstraint(table.priority)} AND ${table.priority} BETWEEN -2147483648 AND 2147483647`,
    ),
    check('project_revision_positive', positiveInteger(table.revision)),
    check('project_config_revision_positive', positiveInteger(table.configRevision)),
    check(
      'project_archive_integer',
      sql`${table.archivedAt} IS NULL OR ${integerConstraint(table.archivedAt)}`,
    ),
    check('project_created_integer', integerConstraint(table.createdAt)),
    check('project_updated_integer', integerConstraint(table.updatedAt)),
    index('projects_priority_slug').on(desc(table.priority), table.slug),
  ],
);

export const projectConfigs = sqliteTable(
  'project_configs',
  {
    projectSlug: text('project_slug')
      .notNull()
      .references(() => projects.slug),
    revision: integer('revision').notNull(),
    priorityModel: text('priority_model', { mode: 'json' }).$type<JsonValue>().notNull(),
    ordinaryWorkflow: text('ordinary_workflow', { mode: 'json' }).$type<JsonValue>().notNull(),
    recurringWorkflow: text('recurring_workflow', { mode: 'json' }).$type<JsonValue>().notNull(),
    semanticSnapshot: text('semantic_snapshot', { mode: 'json' }).$type<JsonValue>().notNull(),
    effectiveAt: integer('effective_at').notNull(),
    actor: text('actor').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectSlug, table.revision] }),
    check('project_config_revision_positive', positiveInteger(table.revision)),
    check('project_config_priority_json', jsonConstraint(table.priorityModel)),
    check('project_config_ordinary_json', jsonConstraint(table.ordinaryWorkflow)),
    check('project_config_recurring_json', jsonConstraint(table.recurringWorkflow)),
    check('project_config_snapshot_json', jsonConstraint(table.semanticSnapshot)),
    check('project_config_effective_integer', integerConstraint(table.effectiveAt)),
    check(
      'project_config_actor',
      sql`${table.actor} = 'human-web' OR ${table.actor} = 'ai-cli:' || ${table.projectSlug}`,
    ),
  ],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectSlug: text('project_slug')
      .notNull()
      .references(() => projects.slug),
    kind: text('kind', { enum: ['ordinary', 'recurring'] }).notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    descriptionHtml: text('description_html').notNull().default(''),
    renderPolicyVersion: integer('render_policy_version').notNull().default(1),
    emoji: text('emoji').notNull().default('⚪'),
    emojiKey: text('emoji_key').notNull().default('⚪'),
    statusId: text('status_id').notNull(),
    priority: text('priority', { mode: 'json' }).$type<JsonValue>(),
    priorityScaled: integer('priority_scaled'),
    deadline: integer('deadline'),
    completionRecordedAt: integer('completion_recorded_at'),
    revision: integer('revision').notNull().default(1),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    unique('tasks_project_id').on(table.projectSlug, table.id),
    unique('tasks_project_id_kind').on(table.projectSlug, table.id, table.kind),
    check('task_id_uuid', uuidConstraint(table.id)),
    check('task_kind_valid', sql`${table.kind} IN ('ordinary', 'recurring')`),
    check(
      'task_title_length',
      sql`length(${table.title}) BETWEEN 1 AND 300 AND length(trim(${table.title})) > 0`,
    ),
    check('task_description_length', sql`length(${table.description}) <= 100000`),
    check('task_render_policy_positive', positiveInteger(table.renderPolicyVersion)),
    check('task_emoji_nonempty', sql`length(${table.emojiKey}) > 0`),
    check(
      'task_status_key',
      sql`instr(${table.statusId}, char(0)) = 0 AND length(${table.statusId}) > 0 AND ${table.statusId} NOT GLOB '*[^A-Za-z0-9_-]*'`,
    ),
    check(
      'task_priority_json',
      sql`${table.priority} IS NULL OR ${jsonConstraint(table.priority)}`,
    ),
    check(
      'task_numeric_thousandths',
      sql`${table.priorityScaled} IS NULL OR (${integerConstraint(table.priorityScaled)} AND ${table.priorityScaled} BETWEEN -1000000000000 AND 1000000000000)`,
    ),
    check(
      'task_deadline_integer',
      sql`${table.deadline} IS NULL OR ${integerConstraint(table.deadline)}`,
    ),
    check(
      'task_recurring_deadline_derived',
      sql`${table.kind} != 'recurring' OR ${table.deadline} IS NULL`,
    ),
    check('task_revision_positive', positiveInteger(table.revision)),
    check(
      'task_completion_recorded_integer',
      sql`${table.completionRecordedAt} IS NULL OR ${integerConstraint(table.completionRecordedAt)}`,
    ),
    check(
      'task_recurring_completion_null',
      sql`${table.kind} != 'recurring' OR ${table.completionRecordedAt} IS NULL`,
    ),
    check(
      'task_archive_integer',
      sql`${table.archivedAt} IS NULL OR ${integerConstraint(table.archivedAt)}`,
    ),
    check('task_created_integer', integerConstraint(table.createdAt)),
    check('task_updated_integer', integerConstraint(table.updatedAt)),
    index('tasks_project_list').on(
      table.projectSlug,
      table.kind,
      table.archivedAt,
      table.statusId,
      table.deadline,
      table.createdAt,
      table.id,
    ),
    index('tasks_project_emoji').on(table.projectSlug, table.emojiKey),
    index('tasks_global_emoji').on(table.emojiKey),
  ],
);

// These owners are historical slugs: a restored database need not have a live project.
export const projectEmojiReservations = sqliteTable(
  'project_emoji_reservations',
  {
    emojiKey: text('emoji_key').primaryKey(),
    projectSlug: text('project_slug').notNull(),
    emoji: text('emoji').notNull(),
    firstReservedAt: integer('first_reserved_at').notNull(),
  },
  (table) => [
    check('project_reservation_scope', slugConstraint(table.projectSlug)),
    check(
      'project_reservation_nondefault',
      sql`length(${table.emojiKey}) > 0 AND ${table.emojiKey} != '⚪'`,
    ),
    check('project_reservation_time', integerConstraint(table.firstReservedAt)),
  ],
);

export const taskEmojiReservations = sqliteTable(
  'task_emoji_reservations',
  {
    projectSlug: text('project_slug').notNull(),
    emojiKey: text('emoji_key').notNull(),
    taskId: text('task_id').notNull().unique(),
  },
  (table) => [
    primaryKey({ columns: [table.projectSlug, table.emojiKey] }),
    foreignKey({
      columns: [table.projectSlug, table.taskId],
      foreignColumns: [tasks.projectSlug, tasks.id],
    }),
    check(
      'task_reservation_nondefault',
      sql`length(${table.emojiKey}) > 0 AND ${table.emojiKey} != '⚪'`,
    ),
  ],
);
