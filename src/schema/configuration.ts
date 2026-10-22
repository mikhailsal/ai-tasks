import * as z from 'zod/mini';
import { configKeySchema, labelSchema } from './values.js';
export const paletteSchema = z.enum([
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'violet',
  'rose',
]);
export const colorPaletteSchema = paletteSchema;
export const classicPriorityLabels = {
  critical: 'Критический',
  high: 'Высокий',
  normal: 'Обычный',
  low: 'Низкий',
} as const;
function exactThousandths(value: number): number | undefined {
  if (!Number.isFinite(value) || Math.abs(value) > 1000000000) return;
  const [mantissa = '', exponentText = '0'] = value.toString().toLowerCase().split('e');
  const [whole = '', fraction = ''] = mantissa.split('.');
  const decimalPlaces = fraction.length - Number(exponentText);
  if (decimalPlaces > 3) return;
  const digits = BigInt(`${whole}${fraction}`);
  return Number(digits * 10n ** BigInt(3 - decimalPlaces));
}
export const numericPrioritySchema = z.number().check(
  z.refine((value) => exactThousandths(value) !== undefined, {
    message: 'Priority must be within ±1000000000 with at most three decimal places',
  }),
);
export function toScaledPriority(value: number): number {
  const validated = numericPrioritySchema.parse(value);
  const scaled = exactThousandths(validated);
  if (scaled === undefined) throw new Error('Validated priority could not be represented');
  return scaled;
}
const namedLevelSchema = z.strictObject({
  id: configKeySchema,
  label: labelSchema,
  color: z.optional(paletteSchema),
});
const namedPriorityModelSchema = z
  .strictObject({
    type: z.literal('named'),
    levels: z.array(namedLevelSchema).check(z.minLength(1)).check(z.maxLength(100)),
  })
  .check(
    z.superRefine((model, context) => {
      const ids = new Set<string>();
      model.levels.forEach((level, index) => {
        if (ids.has(level.id))
          context.addIssue({
            code: 'custom',
            path: ['levels', index, 'id'],
            message: 'Level IDs must be distinct',
          });
        ids.add(level.id);
      });
    }),
  );
const numericPriorityModelSchema = z
  .strictObject({
    type: z.literal('numeric'),
    min: numericPrioritySchema,
    max: numericPrioritySchema,
    direction: z.enum(['higher', 'lower']),
  })
  .check(
    z.refine((model) => model.min < model.max, {
      path: ['max'],
      message: 'Minimum must be lower than maximum',
    }),
  );
export const priorityModelSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('classic') }),
  z.strictObject({ type: z.literal('eisenhower') }),
  namedPriorityModelSchema,
  numericPriorityModelSchema,
]);
export const priorityValueSchema = z.nullable(
  z.discriminatedUnion('model', [
    z.strictObject({
      model: z.literal('classic'),
      level: z.enum(['critical', 'high', 'normal', 'low']),
    }),
    z.strictObject({ model: z.literal('eisenhower'), important: z.boolean(), urgent: z.boolean() }),
    z.strictObject({ model: z.literal('named'), level_id: configKeySchema }),
    z.strictObject({ model: z.literal('numeric'), value: numericPrioritySchema }),
  ]),
);
export type PriorityModel = z.infer<typeof priorityModelSchema>;
export type PriorityValue = z.infer<typeof priorityValueSchema>;
export function validatePriorityForModel(priority: unknown, model: PriorityModel): PriorityValue {
  const validatedModel = priorityModelSchema.parse(model);
  return priorityValueSchema
    .check(
      z.superRefine((value, context) => {
        if (value === null) return;
        if (value.model !== validatedModel.type) {
          context.addIssue({
            code: 'custom',
            path: ['model'],
            message: 'Priority must match the project model',
          });
          return;
        }
        if (
          value.model === 'named' &&
          validatedModel.type === 'named' &&
          !validatedModel.levels.some((level) => level.id === value.level_id)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['level_id'],
            message: 'Named priority must exist in the project model',
          });
        }
        if (
          value.model === 'numeric' &&
          validatedModel.type === 'numeric' &&
          (value.value < validatedModel.min || value.value > validatedModel.max)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['value'],
            message: 'Priority must be within the project bounds',
          });
        }
      }),
    )
    .parse(priority);
}
const transitionSchema = z.strictObject({
  from: configKeySchema,
  to: configKeySchema,
  requires_confirmation: z.boolean(),
});
const workflowStatusFields = {
  id: configKeySchema,
  label: labelSchema,
  color: z.optional(paletteSchema),
};
export const ordinaryCategorySchema = z.enum([
  'not_started',
  'in_progress',
  'review',
  'completed',
  'cancelled',
]);
export const recurringCategorySchema = z.enum(['draft', 'active', 'paused', 'archived']);
const ordinaryWorkflowShape = z.strictObject({
  initial_status_id: configKeySchema,
  statuses: z
    .array(
      z.strictObject({
        ...workflowStatusFields,
        category: ordinaryCategorySchema,
      }),
    )
    .check(z.minLength(1))
    .check(z.maxLength(100)),
  transitions: z.array(transitionSchema),
});
const recurringWorkflowShape = z.strictObject({
  initial_status_id: configKeySchema,
  restore_status_id: configKeySchema,
  statuses: z
    .array(
      z.strictObject({
        ...workflowStatusFields,
        category: recurringCategorySchema,
      }),
    )
    .check(z.minLength(1))
    .check(z.maxLength(100)),
  transitions: z.array(transitionSchema),
});
function checkWorkflow(
  workflow: z.infer<typeof ordinaryWorkflowShape> | z.infer<typeof recurringWorkflowShape>,
  context: z.core.$RefinementCtx<unknown>,
): void {
  const ids = new Set<string>();
  workflow.statuses.forEach((status, index) => {
    if (ids.has(status.id))
      context.addIssue({
        code: 'custom',
        path: ['statuses', index, 'id'],
        message: 'Status IDs must be distinct',
      });
    ids.add(status.id);
  });
  const pairs = new Set<string>();
  workflow.transitions.forEach((edge, index) => {
    if (!ids.has(edge.from) || !ids.has(edge.to))
      context.addIssue({
        code: 'custom',
        path: ['transitions', index],
        message: 'Transition endpoints must exist',
      });
    const pair = JSON.stringify([edge.from, edge.to]);
    if (pairs.has(pair))
      context.addIssue({
        code: 'custom',
        path: ['transitions', index],
        message: 'Transition edges must be distinct',
      });
    pairs.add(pair);
  });
}
export const ordinaryWorkflowSchema = ordinaryWorkflowShape.check(
  z.superRefine((workflow, context) => {
    checkWorkflow(workflow, context);
    if (
      !workflow.statuses.some(
        (status) => status.id === workflow.initial_status_id && status.category === 'not_started',
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['initial_status_id'],
        message: 'Initial ordinary status must have category not_started',
      });
    }
  }),
);
export const recurringWorkflowSchema = recurringWorkflowShape.check(
  z.superRefine((workflow, context) => {
    checkWorkflow(workflow, context);
    if (
      !workflow.statuses.some(
        (status) => status.id === workflow.initial_status_id && status.category === 'draft',
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['initial_status_id'],
        message: 'Initial recurring status must have category draft',
      });
    }
    if (
      !workflow.statuses.some(
        (status) => status.id === workflow.restore_status_id && status.category === 'paused',
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['restore_status_id'],
        message: 'Restore status must have category paused',
      });
    }
  }),
);
export const projectConfigInputSchema = z.strictObject({
  priority_model: priorityModelSchema,
  ordinary_workflow: ordinaryWorkflowSchema,
  recurring_workflow: recurringWorkflowSchema,
});
export type ProjectConfigInput = z.infer<typeof projectConfigInputSchema>;
export type OrdinaryWorkflow = z.infer<typeof ordinaryWorkflowSchema>;
export type RecurringWorkflow = z.infer<typeof recurringWorkflowSchema>;
