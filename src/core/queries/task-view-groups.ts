import { formatTimestamp } from '../time.js';
import type { TaskPageRow } from './task-page.js';

function groupContext(row: TaskPageRow) {
  return {
    project: {
      slug: row.project.slug,
      name: row.project.name,
      emoji: row.project.emoji,
      priority: row.project.priority,
      archived_at: row.project.archivedAt === null ? null : formatTimestamp(row.project.archivedAt),
      config_revision: row.project.configRevision,
    },
    priority_model: row.config.priority_model,
    ordinary_statuses: row.config.ordinary_workflow.statuses,
    recurring_statuses: row.config.recurring_workflow.statuses,
  };
}
/** SQL has already imposed project-first order; each group contains only this page's parents. */
export function groupTaskRows<Item>(rows: TaskPageRow[], item: (row: TaskPageRow) => Item) {
  const groups = new Map<string, ReturnType<typeof groupContext> & { items: Item[] }>();
  for (const row of rows) {
    let group = groups.get(row.project.slug);
    if (!group) {
      group = { ...groupContext(row), items: [] };
      groups.set(row.project.slug, group);
    }
    group.items.push(item(row));
  }
  return [...groups.values()];
}
