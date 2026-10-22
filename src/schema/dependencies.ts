import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { integerConstraint, uuidConstraint } from './constraints.js';
import { tasks } from './entities.js';

export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    dependentTaskId: text('dependent_task_id').notNull(),
    dependentProjectSlug: text('dependent_project_slug').notNull(),
    dependentKind: text('dependent_kind', { enum: ['ordinary'] })
      .notNull()
      .default('ordinary'),
    prerequisiteTaskId: text('prerequisite_task_id').notNull(),
    prerequisiteProjectSlug: text('prerequisite_project_slug').notNull(),
    prerequisiteKind: text('prerequisite_kind', { enum: ['ordinary'] })
      .notNull()
      .default('ordinary'),
    createdAt: integer('created_at').notNull(),
    createdOperationId: text('created_operation_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.dependentTaskId, table.prerequisiteTaskId] }),
    foreignKey({
      columns: [table.dependentProjectSlug, table.dependentTaskId, table.dependentKind],
      foreignColumns: [tasks.projectSlug, tasks.id, tasks.kind],
    }),
    foreignKey({
      columns: [table.prerequisiteProjectSlug, table.prerequisiteTaskId, table.prerequisiteKind],
      foreignColumns: [tasks.projectSlug, tasks.id, tasks.kind],
    }),
    check('dependency_dependent_uuid', uuidConstraint(table.dependentTaskId)),
    check('dependency_prerequisite_uuid', uuidConstraint(table.prerequisiteTaskId)),
    check('dependency_operation_uuid', uuidConstraint(table.createdOperationId)),
    check('dependency_created_integer', integerConstraint(table.createdAt)),
    check('dependency_not_self', sql`${table.dependentTaskId} != ${table.prerequisiteTaskId}`),
    check(
      'dependency_ordinary_endpoints',
      sql`${table.dependentKind} = 'ordinary' AND ${table.prerequisiteKind} = 'ordinary'`,
    ),
    index('dependencies_reverse_idx').on(table.prerequisiteTaskId, table.dependentTaskId),
  ],
);
