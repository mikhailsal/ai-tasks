import { describe, expect, it } from 'vitest';
import {
  configKeySchema,
  descriptionSchema,
  jsonValueSchema,
  labelSchema,
  nameSchema,
  revisionSchema,
  slugSchema,
  timestampSchema,
  timezoneSchema,
  titleSchema,
  validateJsonBodySize,
} from '../../src/schema/values.js';
import { mutationEnvelopeSchema, responseEnvelopeSchema } from '../../src/schema/envelopes.js';

const id = '123e4567-e89b-42d3-a456-426614174000';
const mutation = { operation_id: id, database_epoch: id, payload: { title: 'Task' } };

describe('browser-safe values', () => {
  it('validates slugs and stable ASCII config keys without silently transforming them', () => {
    expect(slugSchema.parse('my-project-1')).toBe('my-project-1');
    expect(slugSchema.safeParse('a'.repeat(64)).success).toBe(true);
    for (const value of ['', 'A', '-a', 'a-', 'a--b', 'a_b', 'a'.repeat(65)]) {
      expect(slugSchema.safeParse(value).success).toBe(false);
    }
    expect(configKeySchema.parse('Priority_1-' + 'a'.repeat(300))).toHaveLength(311);
    expect(configKeySchema.safeParse('priority.key').success).toBe(false);
  });

  it('trims titles and names, counts code points, and preserves raw Markdown', () => {
    expect(titleSchema.parse('  Hello  ')).toBe('Hello');
    expect(titleSchema.safeParse('😀'.repeat(300)).success).toBe(true);
    expect(titleSchema.safeParse('😀'.repeat(301)).success).toBe(false);
    expect(titleSchema.safeParse(' \n ').success).toBe(false);
    for (const schema of [nameSchema, labelSchema]) {
      expect(schema.parse('  Name  ')).toBe('Name');
      expect(schema.safeParse('😀'.repeat(80)).success).toBe(true);
      expect(schema.safeParse('😀'.repeat(81)).success).toBe(false);
    }
    const markdown = '  # Hello\n\n**😀**  ';
    expect(descriptionSchema.parse(markdown)).toBe(markdown);
    expect(descriptionSchema.safeParse('😀'.repeat(100_000)).success).toBe(true);
    expect(descriptionSchema.safeParse('😀'.repeat(100_001)).success).toBe(false);
  });

  it('requires valid calendar instants with offsets and at most millisecond precision', () => {
    for (const value of [
      '2024-02-29T12:30:00Z',
      '2024-02-29T12:30:00.1+03:00',
      '2024-02-29T12:30:00.123-05:30',
      '2000-01-01T00:00:00.00Z',
      '2024-02-29t12:30:00z',
      '2024-02-29T12:30:00z',
      '2024-02-29t12:30:00Z',
      '2024-02-29t12:30:00.123+03:00',
    ]) {
      expect(timestampSchema.safeParse(value).success, value).toBe(true);
    }
    for (const value of [
      '2023-02-29T12:30:00Z',
      '2024-04-31T12:30:00Z',
      '2024-02-29',
      '2024-02-29T12:30:00',
      '2024-02-29T12:30Z',
      '2024-02-29T12:30:00.1234Z',
      '2024-02-29T25:00:00Z',
      '2024-02-29T12:30:00+03',
      '2023-02-29t12:30:00z',
      '2024-02-29t12:30:00.1234z',
      '2024-02-29t12:30:00',
      '2024-02-29 12:30:00z',
      '2024-02-29tt12:30:00z',
      '2024-02-29t12:30:00zz',
    ]) {
      expect(timestampSchema.safeParse(value).success, value).toBe(false);
    }
    expect(timestampSchema.parse('2024-02-29t12:30:00.123z')).toBe('2024-02-29T12:30:00.123Z');
    expect(timestampSchema.parse('2024-02-29t12:30:00.123+03:00')).toBe(
      '2024-02-29T12:30:00.123+03:00',
    );
    expect(timezoneSchema.parse('Europe/Moscow')).toBe('Europe/Moscow');
    expect(timezoneSchema.safeParse('Not/A_Timezone').success).toBe(false);
    expect(timezoneSchema.safeParse('+03:00').success).toBe(false);
  });

  it('accepts only JSON data and positive safe integer revisions', () => {
    expect(jsonValueSchema.parse({ values: [null, true, 1, 'x'] })).toEqual({
      values: [null, true, 1, 'x'],
    });
    for (const value of [undefined, NaN, Infinity, { key: undefined }]) {
      expect(jsonValueSchema.safeParse(value).success).toBe(false);
    }
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(revisionSchema.safeParse(value).success).toBe(false);
    }
  });

  it('enforces the complete serialized JSON body limit in UTF-8 bytes', () => {
    expect(validateJsonBodySize('a'.repeat(1_048_574))).toHaveLength(1_048_574);
    expect(() => validateJsonBodySize('a'.repeat(1_048_575))).toThrow();
    expect(() => validateJsonBodySize('😀'.repeat(262_144))).toThrow();
  });
});

describe('strict snake_case envelopes', () => {
  it('keeps omission distinct from explicit null and rejects unknown/camelCase keys', () => {
    expect(mutationEnvelopeSchema.parse(mutation)).toEqual(mutation);
    expect(mutationEnvelopeSchema.parse({ ...mutation, expected_revision: 1 })).toMatchObject({
      expected_revision: 1,
    });
    for (const extra of [{ expected_revision: null }, { expectedRevision: 1 }, { unknown: true }]) {
      expect(mutationEnvelopeSchema.safeParse({ ...mutation, ...extra }).success).toBe(false);
    }
    expect(mutationEnvelopeSchema.safeParse({ ...mutation, payload: null }).success).toBe(true);
  });

  it('validates success metadata and structured error responses without allowing extra fields', () => {
    const success = {
      ok: true,
      data: { task: null },
      meta: {
        database_epoch: id,
        timezone: 'Europe/Moscow',
        now: '2026-10-21T00:00:00.000Z',
        read_revision: 1,
        as_of: '2026-10-20T00:00:00.000Z',
      },
    };
    expect(responseEnvelopeSchema.parse(success)).toEqual(success);
    expect(
      responseEnvelopeSchema.safeParse({
        ...success,
        meta: { ...success.meta, caller_clock: success.meta.now },
      }).success,
    ).toBe(false);
    const failure = {
      ok: false,
      error: { code: 'DB_CONFLICT', message: 'Database busy', details: null, retryable: true },
    };
    expect(responseEnvelopeSchema.parse(failure)).toEqual(failure);
    expect(responseEnvelopeSchema.safeParse({ ...failure, debug: 'secret' }).success).toBe(false);
  });
});
