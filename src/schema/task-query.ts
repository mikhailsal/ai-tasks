import * as z from 'zod/mini';
import { priorityValueSchema } from './configuration.js';
import { taskCategorySchema } from './tasks.js';
import { configKeySchema, slugSchema } from './values.js';
export const taskReadFilterShape = {
  project_slug: z.optional(slugSchema),
  all_projects: z.optional(z.literal(true)),
  archive: z._default(z.enum(['exclude', 'include', 'only']), 'exclude'),
  include_terminal: z._default(z.boolean(), false),
  q: z.optional(z.string()),
  kind: z.optional(z.enum(['ordinary', 'recurring'])),
  status_id: z.optional(configKeySchema),
  category: z.optional(taskCategorySchema),
  emoji: z.optional(z.string()),
  priority: z.optional(priorityValueSchema),
};
export function explicitTaskReadScope(input: {
  project_slug?: string | undefined;
  all_projects?: true | undefined;
}) {
  return (input.project_slug !== undefined) !== (input.all_projects !== undefined);
}
export const taskListInputSchema = z
  .strictObject({
    ...taskReadFilterShape,
    deadline_preset: z.optional(
      z.enum(['overdue', 'today', 'from_tomorrow', 'next_3_days', 'undated']),
    ),
    deadline_day: z.optional(z.iso.date()),
    limit: z._default(z.int().check(z.minimum(1)).check(z.maximum(200)), 50),
    cursor: z.optional(z.string().check(z.minLength(1)).check(z.maxLength(4096))),
  })
  .check(z.refine(explicitTaskReadScope, 'Supply exactly one explicit project scope'))
  .check(
    z.refine(
      (input) => input.deadline_day === undefined || input.deadline_preset === undefined,
      'Supply either an exact deadline day or a deadline preset',
    ),
  );
