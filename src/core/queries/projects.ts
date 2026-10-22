import { and, asc, desc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { z } from 'zod/mini';
import { projects } from '../../schema/entities.js';
import { successEnvelopeSchema } from '../../schema/envelopes.js';
import { projectResourceSchema } from '../../schema/projects.js';
import { slugSchema } from '../../schema/values.js';
import type { CoreContext } from '../database/types.js';
import { projectResource, requireProject } from '../projects/read.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { nextPageCursor, paginationContext, queryMetadata, queryState } from './page.js';
import { queryFingerprint } from './cursor.js';
type ReadContext = Pick<CoreContext, 'connection' | 'now'>;
export const projectListInputSchema = z
  .strictObject({
    project_slug: z.optional(slugSchema),
    all_projects: z.optional(z.literal(true)),
    archive: z._default(z.enum(['exclude', 'include', 'only']), 'exclude'),
    limit: z._default(z.int().check(z.minimum(1)).check(z.maximum(200)), 50),
    cursor: z.optional(z.string().check(z.minLength(1)).check(z.maxLength(4096))),
  })
  .check(
    z.refine(
      (input) => (input.project_slug !== undefined) !== (input.all_projects !== undefined),
      'Supply exactly one explicit project scope',
    ),
  );
const projectEnvelopeSchema = z.extend(successEnvelopeSchema, { data: projectResourceSchema });
const projectPageSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({
    items: z.array(projectResourceSchema),
    next_cursor: z.nullable(z.string()),
  }),
});
export function getProject(context: ReadContext, projectSlug: string) {
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    const project = requireProject(transaction, projectSlug);
    return projectEnvelopeSchema.parse({
      ok: true,
      data: projectResource(project),
      meta: queryMetadata(state, now),
    });
  });
}
export function listProjects(context: ReadContext, input: z.input<typeof projectListInputSchema>) {
  const parsed = parseInput(projectListInputSchema, input);
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    if (parsed.project_slug !== undefined) requireProject(transaction, parsed.project_slug);
    const query = queryFingerprint({
      kind: 'projects',
      order: 'priority_desc_slug_asc_v1',
      project_slug: parsed.project_slug ?? null,
      all_projects: parsed.all_projects ?? false,
      archive: parsed.archive,
      limit: parsed.limit,
    });
    const page = paginationContext({ state, query, now, cursor: parsed.cursor });
    const filters: SQL[] = [];
    if (parsed.project_slug !== undefined) filters.push(eq(projects.slug, parsed.project_slug));
    if (parsed.archive === 'exclude') filters.push(isNull(projects.archivedAt));
    if (parsed.archive === 'only') filters.push(isNotNull(projects.archivedAt));
    const rows = transaction
      .select()
      .from(projects)
      .where(and(...filters))
      .orderBy(desc(projects.priority), asc(projects.slug))
      .limit(parsed.limit + 1)
      .offset(page.offset)
      .all();
    const items = rows.slice(0, parsed.limit).map(projectResource);
    const nextCursor =
      rows.length > parsed.limit
        ? nextPageCursor({
            state,
            query,
            asOf: page.asOf,
            offset: page.offset + items.length,
          })
        : null;
    return projectPageSchema.parse({
      ok: true,
      data: { items, next_cursor: nextCursor },
      meta: queryMetadata(state, now, page.asOf),
    });
  });
}
