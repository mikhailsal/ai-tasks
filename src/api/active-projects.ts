import * as z from 'zod/mini';
import { DomainError } from '../core/errors.js';
import { successEnvelopeSchema, type SuccessEnvelope } from '../schema/envelopes.js';
import { projectResourceSchema } from '../schema/projects.js';
import type { HelperCommand } from './helper-protocol.js';
const pageSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({
    items: z.array(projectResourceSchema),
    next_cursor: z.nullable(z.string()),
  }),
});
/** Concurrent domain writes can invalidate a scan; defer after bounded fresh attempts. */
export async function activeProjectScopes(
  request: (command: HelperCommand) => Promise<SuccessEnvelope>,
): Promise<string[] | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const slugs: string[] = [];
      let cursor: string | undefined;
      do {
        const page = pageSchema.parse(
          await request({
            operation: 'project.list',
            input: {
              all_projects: true,
              archive: 'exclude',
              limit: 200,
              ...(cursor === undefined ? {} : { cursor }),
            },
          }),
        );
        slugs.push(...page.data.items.map((project) => project.slug));
        cursor = page.data.next_cursor ?? undefined;
      } while (cursor !== undefined);
      return slugs;
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== 'CURSOR_STALE') throw error;
    }
  }
  return undefined;
}
