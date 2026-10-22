import { and, eq, gt, ne, sql } from 'drizzle-orm';
import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { applicationState, tasks } from '../../schema/entities.js';
import { occurrences } from '../../schema/recurrence.js';
import { descriptionSchema } from '../../schema/values.js';
import type { DatabaseConnection, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';

// Increment whenever parsing/sanitization changes; source and audit remain authoritative.
export const RENDER_POLICY_VERSION = 1;
const RENDER_PAGE_SIZE = 16;

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const markdown = new Marked({
  gfm: false,
  breaks: false,
  async: false,
  renderer: {
    html({ text }) {
      return sanitizeHtml(text, {
        allowedTags: [],
        allowedAttributes: {},
        disallowedTagsMode: 'discard',
      });
    },
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

/** This returns derived display HTML; it never replaces or reformats Markdown source. */
export function renderMarkdown(source: string): string {
  const parsed = descriptionSchema.safeParse(source);
  if (!parsed.success)
    throw domainError(
      'VALIDATION_ERROR',
      'Description must contain at most 100,000 Unicode code points',
    );
  const html = markdown.parse(parsed.data, { async: false });
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'strong',
      'em',
      'ul',
      'ol',
      'li',
      'a',
      'pre',
      'code',
      'blockquote',
      'br',
      'hr',
    ],
    allowedAttributes: { a: ['href', 'title'], ol: ['start'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
  });
}

// Keyset pages bound retained sources even when every description is at its size limit.
// Individual writes are necessary because each row renders a distinct source.
function refreshTasks(transaction: DatabaseTransaction): boolean {
  let cursor = '';
  let changed = false;
  for (;;) {
    const page = transaction
      .select({ id: tasks.id, source: tasks.description })
      .from(tasks)
      .where(and(ne(tasks.renderPolicyVersion, RENDER_POLICY_VERSION), gt(tasks.id, cursor)))
      .orderBy(tasks.id)
      .limit(RENDER_PAGE_SIZE)
      .all();
    const last = page.at(-1);
    if (!last) return changed;
    for (const row of page) {
      transaction
        .update(tasks)
        .set({
          descriptionHtml: renderMarkdown(row.source),
          renderPolicyVersion: RENDER_POLICY_VERSION,
        })
        .where(eq(tasks.id, row.id))
        .run();
    }
    cursor = last.id;
    changed = true;
  }
}

function refreshOccurrences(transaction: DatabaseTransaction): boolean {
  let cursor = '';
  let changed = false;
  for (;;) {
    const page = transaction
      .select({ id: occurrences.id, source: occurrences.descriptionSnapshot })
      .from(occurrences)
      .where(
        and(ne(occurrences.renderPolicyVersion, RENDER_POLICY_VERSION), gt(occurrences.id, cursor)),
      )
      .orderBy(occurrences.id)
      .limit(RENDER_PAGE_SIZE)
      .all();
    const last = page.at(-1);
    if (!last) return changed;
    for (const row of page) {
      transaction
        .update(occurrences)
        .set({
          descriptionHtmlSnapshot: renderMarkdown(row.source),
          renderPolicyVersion: RENDER_POLICY_VERSION,
        })
        .where(eq(occurrences.id, row.id))
        .run();
    }
    cursor = last.id;
    changed = true;
  }
}

/** All bounded pages share one immediate transaction and the existing lifetime lock. */
export function refreshRenderedDescriptions(connection: DatabaseConnection): void {
  connection.db.transaction(
    (transaction) => {
      const tasksChanged = refreshTasks(transaction);
      const occurrencesChanged = refreshOccurrences(transaction);
      if (!tasksChanged && !occurrencesChanged) return;
      transaction
        .update(applicationState)
        .set({ readRevision: sql`${applicationState.readRevision} + 1` })
        .where(eq(applicationState.id, 1))
        .run();
    },
    { behavior: 'immediate' },
  );
}
