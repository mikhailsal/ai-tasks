import { z } from 'zod/mini';
import {
  ordinaryWorkflowSchema,
  recurringWorkflowSchema,
  priorityModelSchema,
} from './configuration.js';
import { responseMetaSchema, successEnvelopeSchema } from './envelopes.js';
import { projectResourceSchema } from './projects.js';
import { taskResourceSchema } from './tasks.js';
import { explicitTaskReadScope, taskListInputSchema, taskReadFilterShape } from './task-query.js';
import { revisionSchema, timestampSchema } from './values.js';
export const agendaInputSchema = taskListInputSchema;
export const prioritiesInputSchema = taskListInputSchema;
export const statisticsInputSchema = z
  .strictObject({
    ...taskReadFilterShape,
    from: z.optional(timestampSchema),
    to: z.optional(timestampSchema),
  })
  .check(z.refine(explicitTaskReadScope, 'Supply exactly one explicit project scope'))
  .check(
    z.refine(
      (input) =>
        input.from === undefined ||
        input.to === undefined ||
        Date.parse(input.from) <= Date.parse(input.to),
      'from must not be after to',
    ),
  );
const readViewMetaSchema = z.extend(responseMetaSchema, {
  as_of: timestampSchema,
  read_revision: revisionSchema,
});
export const viewProjectSchema = z.pick(projectResourceSchema, {
  slug: true,
  name: true,
  emoji: true,
  priority: true,
  archived_at: true,
  config_revision: true,
});
const group = {
  project: viewProjectSchema,
  priority_model: priorityModelSchema,
  ordinary_statuses: ordinaryWorkflowSchema.shape.statuses,
  recurring_statuses: recurringWorkflowSchema.shape.statuses,
};
export const bucketSchema = z.enum(['overdue', 'today', 'next_7_days', 'later', 'no_deadline']);
export const agendaPageEnvelopeSchema = z.extend(successEnvelopeSchema, {
  meta: readViewMetaSchema,
  data: z.strictObject({
    groups: z.array(
      z.strictObject({
        ...group,
        items: z.array(z.extend(taskResourceSchema, { agenda_bucket: bucketSchema })),
      }),
    ),
    next_cursor: z.nullable(z.string()),
  }),
});
export const prioritiesPageEnvelopeSchema = z.extend(successEnvelopeSchema, {
  meta: readViewMetaSchema,
  data: z.strictObject({
    groups: z.array(z.strictObject({ ...group, items: z.array(taskResourceSchema) })),
    next_cursor: z.nullable(z.string()),
  }),
});
const count = z.int().check(z.nonnegative());
export const statisticsCounters = {
  tasks: z.strictObject({
    by_kind: z.strictObject({ ordinary: count, recurring: count }),
    by_category: z.strictObject({
      not_started: count,
      in_progress: count,
      review: count,
      completed: count,
      cancelled: count,
      draft: count,
      active: count,
      paused: count,
      archived: count,
    }),
    total: count,
  }),
  ordinary: z.strictObject({ unfinished: count, overdue: count, completed: count }),
  occurrences: z.strictObject({
    pending: count,
    debt: count,
    missed: count,
    completed: count,
    completed_late: count,
    cancelled: count,
    total: count,
  }),
};
export const statisticsEnvelopeSchema = z.extend(successEnvelopeSchema, {
  meta: readViewMetaSchema,
  data: z.strictObject({
    ...statisticsCounters,
    groups: z.array(
      z.strictObject({
        project: viewProjectSchema,
        priority_model: priorityModelSchema,
        ...statisticsCounters,
      }),
    ),
  }),
});
