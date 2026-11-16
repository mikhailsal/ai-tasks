import { expect, it } from 'vitest';
import * as z from 'zod/mini';
import { flattenSchema } from '../../src/cli/registry/flatten-schema.js';
import { completeOccurrencesSchema } from '../../src/schema/recurrence-input.js';
import { taskCreateSchema } from '../../src/schema/tasks.js';
import { timestampSchema, uuidSchema } from '../../src/schema/values.js';

it('lists list items with [] names, repeats and bounds, and names timestamps', () => {
  expect(flattenSchema(completeOccurrencesSchema)).toEqual([
    {
      name: 'occurrences[].actual_completed_at',
      type: 'timestamp',
      required: false,
      repeats: true,
      min: 1,
    },
    {
      name: 'occurrences[].expected_revision',
      type: 'integer',
      required: true,
      repeats: true,
      min: 1,
    },
    { name: 'occurrences[].id', type: 'uuid', required: true, repeats: true, min: 1 },
  ]);
});

it('a discriminated union becomes one field with its allowed values and per-value fields', () => {
  const [kind, ...rest] = flattenSchema(taskCreateSchema);
  expect(rest).toEqual([]);
  expect(kind).toMatchObject({ name: 'kind', required: true, allowed: ['ordinary', 'recurring'] });
  const ordinary = kind?.alternatives?.find((entry) => entry.when === 'ordinary');
  expect(ordinary?.fields.map((field) => field.name)).toEqual(
    expect.arrayContaining(['title', 'status_id', 'priority.model']),
  );
  expect(ordinary?.fields.find((field) => field.name === 'status_id')?.source).toMatchObject({
    action: 'read_allowed_values',
    command: 'config get',
  });
  expect(ordinary?.fields.find((field) => field.name === 'title')?.required).toBe(true);
});

it('nullable, enum, nested and omitted fields', () => {
  const schema = z.strictObject({
    when: z.nullable(timestampSchema),
    mode: z.enum(['a', 'b']),
    target: z.strictObject({ id: uuidSchema, note: z.optional(z.string()) }),
    project_slug: z.string(),
  });
  expect(flattenSchema(schema, ['project_slug'])).toEqual([
    { name: 'mode', type: 'string', required: true, allowed: ['a', 'b'] },
    { name: 'target.id', type: 'uuid', required: true },
    { name: 'target.note', type: 'string', required: false },
    { name: 'when', type: 'timestamp', required: true, nullable: true },
  ]);
});
