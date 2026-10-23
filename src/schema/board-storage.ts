import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects, tasks } from './entities.js';
import { positiveInteger } from './constraints.js';
export const boardColumns = sqliteTable(
  'board_columns',
  {
    projectSlug: text('project_slug')
      .notNull()
      .references(() => projects.slug),
    kind: text('kind', { enum: ['ordinary', 'recurring'] }).notNull(),
    statusId: text('status_id').notNull(),
    revision: integer('revision').notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.projectSlug, table.kind, table.statusId] }),
    check('board_column_revision_positive', positiveInteger(table.revision)),
    check('board_column_kind_valid', sql`${table.kind} IN ('ordinary','recurring')`),
  ],
);
export const boardOrder = sqliteTable(
  'board_order',
  {
    taskId: text('task_id')
      .primaryKey()
      .references(() => tasks.id),
    projectSlug: text('project_slug')
      .notNull()
      .references(() => projects.slug),
    kind: text('kind', { enum: ['ordinary', 'recurring'] }).notNull(),
    statusId: text('status_id').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    index('board_order_column_position').on(
      table.projectSlug,
      table.kind,
      table.statusId,
      table.position,
      table.taskId,
    ),
    check('board_order_position_positive', positiveInteger(table.position)),
    check('board_order_kind_valid', sql`${table.kind} IN ('ordinary','recurring')`),
  ],
);
