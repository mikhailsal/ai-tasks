import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { z } from 'zod/mini';
import { readJsonInput } from '../../src/cli/io.js';
import { fingerprintRequest } from '../../src/core/audit/receipts.js';
import { mutationEnvelopeSchema } from '../../src/schema/envelopes.js';
import { jsonValueSchema } from '../../src/schema/values.js';
async function* input(text: string) {
  yield new TextEncoder().encode(text);
}
it('preserves a CLI input own __proto__ key so strict command validation rejects it', async () => {
  const parsed = await readJsonInput('-', input('{"__proto__":{"private":1}}'));
  expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
  expect(JSON.stringify(parsed)).toBe('{"__proto__":{"private":1}}');
  expect(z.strictObject({}).safeParse(parsed).success).toBe(false);
});
it.each(['{"nested":{"__proto__":{"changed":1}}}', '{"nested":[{"__proto__":{"changed":1}}]}'])(
  'preserves nested own prototype keys through mutation-envelope parsing: %s',
  (json) => {
    const request = {
      operation_id: randomUUID(),
      database_epoch: randomUUID(),
      payload: JSON.parse(json),
    };
    expect(JSON.stringify(mutationEnvelopeSchema.parse(request).payload)).toBe(json);
  },
);
it('gives a changed prototype payload a different canonical request fingerprint', () => {
  const original = mutationEnvelopeSchema.parse({
    operation_id: randomUUID(),
    database_epoch: randomUUID(),
    payload: { nested: {} },
  });
  const changed = { ...original, payload: JSON.parse('{"nested":{"__proto__":{"changed":1}}}') };
  const parsed = mutationEnvelopeSchema.parse(changed);
  const identity = {
    operation: 'test',
    project_slug: 'alpha',
    actor: 'human-web',
    origin: 'web',
    target: null,
  };
  expect(fingerprintRequest({ ...identity, input: parsed })).not.toBe(
    fingerprintRequest({ ...identity, input: original }),
  );
});
it('validates JSON without executing own getters', () => {
  let reads = 0;
  const value = Object.defineProperty({}, 'private', {
    enumerable: true,
    get() {
      reads += 1;
      return 'private input';
    },
  });
  expect(jsonValueSchema.safeParse(value).success).toBe(false);
  expect(reads).toBe(0);
});
it('preserves ordinary own JSON keys and values, including constructor and prototype names', async () => {
  const text = '{"constructor":{"prototype":[null,true,2,"原文 🔵"]},"nested":{"a":1,"b":2}}';
  expect(jsonValueSchema.parse(JSON.parse(text))).toEqual(JSON.parse(text));
  expect(await readJsonInput('-', input(text))).toEqual(JSON.parse(text));
});
it('rejects cyclic and non-JSON class objects safely', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(jsonValueSchema.safeParse(cyclic).success).toBe(false);
  expect(jsonValueSchema.safeParse(new Date()).success).toBe(false);
});
it('rejects data shapes that JSON serialization would silently omit or replace', () => {
  const hidden = Object.defineProperty({}, 'hidden', { value: 1, enumerable: false });
  const sparse: unknown[] = [];
  sparse.length = 1;
  const extra = Object.assign([1], { extra: 2 });
  for (const value of [hidden, sparse, extra, { [Symbol('hidden')]: 1 }]) {
    expect(jsonValueSchema.safeParse(value).success).toBe(false);
  }
});
it('rejects array accessor indices without invoking them and accepts repeated shared references', () => {
  let reads = 0;
  const array = Object.defineProperty([], '0', {
    enumerable: true,
    get() {
      reads += 1;
      return 1;
    },
  });
  expect(jsonValueSchema.safeParse(array).success).toBe(false);
  expect(reads).toBe(0);
  const child = { value: 1 };
  expect(jsonValueSchema.parse([child, child])).toEqual([{ value: 1 }, { value: 1 }]);
});
