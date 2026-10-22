import { eq, gt } from 'drizzle-orm';
import { tasks } from '../../schema/entities.js';
import { occurrences } from '../../schema/recurrence.js';
import type { DatabaseTransaction } from '../database/types.js';
import { renderMarkdown, RENDER_POLICY_VERSION } from '../markdown/render.js';

const pageSize = 16;
function renderTasks(transaction: DatabaseTransaction): void {
  let cursor = '';
  for (;;) {
    const page = transaction
      .select({ id: tasks.id, source: tasks.description })
      .from(tasks)
      .where(gt(tasks.id, cursor))
      .orderBy(tasks.id)
      .limit(pageSize)
      .all();
    const last = page.at(-1);
    if (!last) return;
    for (const task of page) {
      transaction
        .update(tasks)
        .set({
          descriptionHtml: renderMarkdown(task.source),
          renderPolicyVersion: RENDER_POLICY_VERSION,
        })
        .where(eq(tasks.id, task.id))
        .run();
    }
    cursor = last.id;
  }
}
function renderOccurrences(transaction: DatabaseTransaction): void {
  let cursor = '';
  for (;;) {
    const page = transaction
      .select({ id: occurrences.id, source: occurrences.descriptionSnapshot })
      .from(occurrences)
      .where(gt(occurrences.id, cursor))
      .orderBy(occurrences.id)
      .limit(pageSize)
      .all();
    const last = page.at(-1);
    if (!last) return;
    for (const occurrence of page) {
      transaction
        .update(occurrences)
        .set({
          descriptionHtmlSnapshot: renderMarkdown(occurrence.source),
          renderPolicyVersion: RENDER_POLICY_VERSION,
        })
        .where(eq(occurrences.id, occurrence.id))
        .run();
    }
    cursor = last.id;
  }
}
/** Restore trusts source, never a cache carrying even the current policy version. */
export function rebuildStagedDescriptions(transaction: DatabaseTransaction): void {
  // Per-row rendering is necessary; pages bound retained 100,000-codepoint sources.
  renderTasks(transaction);
  renderOccurrences(transaction);
}
