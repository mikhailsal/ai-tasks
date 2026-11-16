import * as z from 'zod/mini';
import { successEnvelopeSchema } from './envelopes.js';
import { uuidSchema } from './values.js';

/** Spec 008: calendar days, declared and recorded values, goal progress. */
export const dayStringSchema = z
  .string()
  .check(z.regex(/^\d{4}-\d{2}-\d{2}$/u))
  .check(
    z.refine((day) => {
      const parsed = new Date(`${day}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day);
    }, 'Day must be a real calendar date YYYY-MM-DD'),
  );

export const valueKinds = ['number', 'time_of_day', 'duration'] as const;
export const valueKindSchema = z.enum(valueKinds);
export const valueNameSchema = z.string().check(z.regex(/^[a-z][a-z0-9_]{0,31}$/u));
export const valueDeclarationSchema = z.strictObject({
  name: valueNameSchema,
  kind: valueKindSchema,
});
export const valueDeclarationsSchema = z
  .array(valueDeclarationSchema)
  .check(z.maxLength(8))
  .check(
    z.refine(
      (list) => new Set(list.map((entry) => entry.name)).size === list.length,
      'Value names must be distinct',
    ),
  );
export type ValueDeclaration = z.infer<typeof valueDeclarationSchema>;

/** As sent on a completion item: `{name: value}`; checked against the declarations in core. */
export const recordedValuesInputSchema = z.record(
  valueNameSchema,
  z.union([z.number(), z.string()]),
);

/** As stored and returned: each value keeps its kind, so later declaration changes cannot reinterpret it. */
export const recordedValuesSchema = z.record(
  valueNameSchema,
  z.strictObject({ kind: valueKindSchema, value: z.union([z.number(), z.string()]) }),
);

export const MAX_DAY_WINDOW = 366;
export const progressInputSchema = z.strictObject({
  from_day: dayStringSchema,
  to_day: dayStringSchema,
});
const count = z.int().check(z.nonnegative());
export const progressResourceSchema = z.strictObject({
  task_id: uuidSchema,
  from_day: dayStringSchema,
  to_day: dayStringSchema,
  done: count,
  decided: count,
  open: count,
  breakdown: z.strictObject({
    completed: count,
    completed_late: count,
    missed: count,
    debt: count,
  }),
});
export type ProgressResource = z.infer<typeof progressResourceSchema>;
export const progressEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: progressResourceSchema,
});
