import { z } from 'zod/mini';
import {
  ordinaryWorkflowSchema,
  recurringWorkflowSchema,
  priorityModelSchema,
} from '../../src/schema/configuration.js';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { projectResourceSchema } from '../../src/schema/projects.js';
import { taskResourceSchema } from '../../src/schema/tasks.js';
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
export const agendaPageSchema = z.extend(successEnvelopeSchema, {
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
export const prioritiesPageSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({
    groups: z.array(z.strictObject({ ...group, items: z.array(taskResourceSchema) })),
    next_cursor: z.nullable(z.string()),
  }),
});
const count = z.int().check(z.nonnegative());
export const statisticsCounters = {
  tasks: z.strictObject({
    by_kind: z.strictObject({ ordinary: count, recurring: count }),
    by_category: z.record(z.string(), count),
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
export const statisticsSchema = z.extend(successEnvelopeSchema, {
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
