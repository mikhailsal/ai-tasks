import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { integerConstraint } from './constraints.js';
import { projects } from './entities.js';

/**
 * Spec 011: when the recurring worker last completed a pass for a project. Operational state,
 * written only by the worker, not audited and not counted in `read_revision`.
 */
export const workerPasses = sqliteTable(
  'worker_passes',
  {
    projectSlug: text('project_slug')
      .primaryKey()
      .references(() => projects.slug),
    lastPassAt: integer('last_pass_at').notNull(),
  },
  (table) => [check('worker_passes_last_pass_integer', integerConstraint(table.lastPassAt))],
);
