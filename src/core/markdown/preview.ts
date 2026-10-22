import { eq } from 'drizzle-orm';
import * as z from 'zod/mini';
import { projects } from '../../schema/entities.js';
import { successEnvelopeSchema } from '../../schema/envelopes.js';
import { descriptionSchema, slugSchema } from '../../schema/values.js';
import type { CoreContext } from '../database/types.js';
import { domainError, normalizeError } from '../errors.js';
import { readMeta } from '../queries/meta.js';
import { renderMarkdown } from './render.js';
const previewInputSchema = z.strictObject({ description: descriptionSchema });
export function previewDescription(
  context: Pick<CoreContext, 'connection' | 'now'>,
  projectSlug: string,
  input: z.input<typeof previewInputSchema>,
) {
  const scope = slugSchema.safeParse(projectSlug);
  const parsed = previewInputSchema.safeParse(input);
  if (!scope.success) throw normalizeError(scope.error);
  if (!parsed.success) throw normalizeError(parsed.error);
  const project = context.connection.db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, scope.data))
    .get();
  if (!project) throw domainError('PROJECT_NOT_FOUND', 'The requested project does not exist');
  const { meta } = readMeta(context, { all_projects: true });
  return z
    .extend(successEnvelopeSchema, { data: z.strictObject({ rendered_html: z.string() }) })
    .parse({
      ok: true,
      data: { rendered_html: renderMarkdown(parsed.data.description) },
      meta,
    });
}
