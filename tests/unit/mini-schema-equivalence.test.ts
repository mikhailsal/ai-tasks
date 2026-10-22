import { describe, expect, it } from 'vitest';
import * as classic from 'zod';
import * as mini from 'zod/mini';
import { safeParse, type $ZodType } from 'zod/v4/core';
import {
  descriptionSchema,
  jsonValueSchema,
  revisionSchema,
  timestampSchema,
  titleSchema,
} from '../../src/schema/values.js';

function outcome(schema: $ZodType, value: unknown) {
  const result = safeParse(schema, value);
  return result.success
    ? { success: true, data: result.data }
    : {
        success: false,
        issues: result.error.issues.map(({ code, path }) => ({ code, path })),
      };
}

function equivalent(left: $ZodType, right: $ZodType, inputs: unknown[]) {
  for (const input of inputs) expect(outcome(right, input)).toEqual(outcome(left, input));
}

describe('public Zod Mini preserves boundary semantics', () => {
  it('retains safe integer limits and positive revision guards', () => {
    const reference = classic.number().int().positive();
    const inputs = [
      undefined,
      null,
      -1,
      0,
      1,
      1.001,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER + 1,
      Number.MIN_SAFE_INTEGER - 1,
      Infinity,
      NaN,
      '1',
    ];
    equivalent(reference, mini.int().check(mini.positive()), inputs);
    equivalent(reference, revisionSchema, inputs);
  });

  it('distinguishes undefined defaults, nullable values, and transformed outputs', () => {
    const reference = classic
      .string()
      .transform((value) => value.length)
      .nullable()
      .default(7);
    const migrated = mini._default(
      mini.nullable(
        mini.pipe(
          mini.string(),
          mini.transform((value) => value.length),
        ),
      ),
      7,
    );
    equivalent(reference, migrated, [undefined, null, '', 'three', 0, false]);
    expect(migrated.parse(undefined)).toBe(7);
    expect(migrated.parse(null)).toBeNull();
    expect(migrated.parse('three')).toBe(5);
  });

  it('trims before checks and pipes without changing source-only descriptions', () => {
    const reference = classic.string().trim().pipe(classic.string().min(1).max(3));
    const migrated = mini.pipe(
      mini.string().check(mini.trim()),
      mini.string().check(mini.minLength(1), mini.maxLength(3)),
    );
    equivalent(reference, migrated, ['', '   ', ' a ', ' abc ', ' abcd ', null]);
    expect(titleSchema.parse('  😀 title  ')).toBe('😀 title');
    const source = '  # Heading\r\n\n[link](https://example.com)  ';
    expect(descriptionSchema.parse(source)).toBe(source);
  });

  it('preserves strict object checks and custom issue paths through extension', () => {
    const reference = classic
      .strictObject({ amount: classic.number() })
      .superRefine((value, ctx) => {
        if (value.amount < 0)
          ctx.addIssue({ code: 'custom', path: ['amount'], message: 'negative' });
      })
      .extend({ label: classic.string() });
    const migrated = mini.extend(
      mini.strictObject({ amount: mini.number() }).check(
        mini.superRefine((value, ctx) => {
          if (value.amount < 0)
            ctx.addIssue({ code: 'custom', path: ['amount'], message: 'negative' });
        }),
      ),
      { label: mini.string() },
    );
    equivalent(reference, migrated, [
      { amount: 1, label: 'valid' },
      { amount: -1, label: 'negative' },
      { amount: 1, label: 'extra', unknown: true },
      { amount: '1', label: 'wrong' },
    ]);
    expect(outcome(migrated, { amount: -1, label: 'negative' })).toEqual({
      success: false,
      issues: [{ code: 'custom', path: ['amount'] }],
    });
  });

  it('retains timestamp normalization, calendar, explicit offset and precision checks', () => {
    const normalize = (value: string) => value.replace('t', 'T').replace(/z$/, 'Z');
    const precision = /T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
    const reference = classic
      .string()
      .transform(normalize)
      .pipe(classic.iso.datetime({ offset: true }).regex(precision));
    const migrated = mini.pipe(
      mini.pipe(mini.string(), mini.transform(normalize)),
      mini.iso.datetime({ offset: true }).check(mini.regex(precision)),
    );
    const inputs = [
      '2024-02-29t10:20:30.001z',
      '2026-10-22T10:20:30+03:00',
      '2026-02-29T10:20:30Z',
      '2026-10-22',
      '2026-10-22T10:20:30',
      '2026-10-22T10:20:30.0001Z',
      '2026-10-22T10:20:30+24:00',
    ];
    equivalent(reference, migrated, inputs);
    equivalent(reference, timestampSchema, inputs);
    expect(timestampSchema.parse(inputs[0])).toBe('2024-02-29T10:20:30.001Z');
  });

  it('keeps every own JSON key while rejecting non-wire descriptors without invoking them', () => {
    const input: unknown = JSON.parse('{"__proto__":{"kept":true},"nested":[null,1]}');
    const parsed = jsonValueSchema.parse(input);
    expect(parsed).toBe(input);
    expect(
      typeof parsed === 'object' && parsed !== null && Object.hasOwn(parsed, '__proto__'),
    ).toBe(true);
    let reads = 0;
    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        reads += 1;
        return 'secret';
      },
    });
    expect(jsonValueSchema.safeParse(accessor).success).toBe(false);
    expect(reads).toBe(0);
  });
});
