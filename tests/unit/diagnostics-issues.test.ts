import { expect, it } from 'vitest';
import { z } from 'zod/mini';
import { errorEnvelope } from '../../src/core/errors.js';
import { cutList } from '../../src/core/diagnostics/bounds.js';
import { displayPath, safeNames } from '../../src/core/diagnostics/safe-names.js';

const schema = z.strictObject({
  level: z.enum(['critical', 'high', 'normal', 'low']),
  count: z.int().check(z.minimum(1)),
  title: z.string(),
  schedule: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('calendar') }),
    z.strictObject({ mode: z.literal('after_completion') }),
  ]),
  value: z.union([z.string(), z.int()]),
});

function details(input: unknown) {
  const parsed = schema.safeParse(input);
  if (parsed.success) throw new Error('Expected a validation failure');
  return errorEnvelope(parsed.error).error;
}

it('adds allowed values, bounds, expected types and union alternatives without input values', () => {
  const secret = 'private-title-value';
  const error = details({
    level: secret,
    count: 0,
    title: 5,
    schedule: { mode: 'weekly' },
    value: true,
    expected_revison: 1,
  });
  expect(error.code).toBe('VALIDATION_ERROR');
  expect(error.message).toBe(
    'Invalid request: level must be one of critical, high, normal, low (and 5 more)',
  );
  expect(error.details).toMatchObject({
    issues: [
      { code: 'invalid_value', path: ['level'], allowed: ['critical', 'high', 'normal', 'low'] },
      { code: 'too_small', path: ['count'], minimum: 1 },
      { code: 'invalid_type', path: ['title'], expected: 'string' },
      {
        code: 'invalid_union',
        alternatives: [{ discriminator: 'mode', allowed: ['calendar', 'after_completion'] }],
      },
      {
        code: 'invalid_union',
        path: ['value'],
        alternatives: [{ expected: 'string' }, { expected: 'number' }],
      },
      { code: 'unrecognized_keys', path: [], keys: ['expected_revison'] },
    ],
  });
  expect(JSON.stringify(error)).not.toContain(secret);
});

it('repeats unknown names only in safe form and counts the rest', () => {
  const names = [
    'ok_name',
    'Bad Name',
    '../etc/passwd',
    ...Array.from({ length: 12 }, (_, i) => `n${i}`),
  ];
  const result = safeNames(names);
  expect(result.names).toHaveLength(10);
  expect(result.names[0]).toBe('ok_name');
  expect(result.omitted).toBe(5);
});

it('cuts lists and reports how many were omitted', () => {
  expect(cutList([1, 2, 3], 2)).toEqual({ items: [1, 2], omitted: 1 });
  expect(cutList([1], 2)).toEqual({ items: [1], omitted: 0 });
});

it('renders paths with indexes and hides unsafe segments', () => {
  expect(displayPath(['occurrences', 0, 'id'])).toBe('occurrences[0].id');
  expect(displayPath(['Секрет', 'id'])).toBe('[field].id');
  expect(displayPath([])).toBe('request');
});
