import { afterEach, expect, it, vi } from 'vitest';
import { uuidSchema } from '../../src/schema/values.js';
import { createDraft, parseProposal, proposalFor } from '../../web/src/data/drafts.js';
import { browserUuid } from '../../web/src/data/uuid.js';
afterEach(() => vi.unstubAllGlobals());
const known = '12345678-1234-4234-8234-123456789abc';
it('uses the native cryptographic UUID implementation when present', () => {
  const native = vi.fn(() => known);
  const randomValues = vi.fn(() => {
    throw new Error('Fallback must not run');
  });
  vi.stubGlobal('crypto', { randomUUID: native, getRandomValues: randomValues });
  expect(browserUuid()).toBe(known);
  expect(native).toHaveBeenCalledOnce();
  expect(randomValues).not.toHaveBeenCalled();
});
it('uses sixteen secure random bytes and preserves v4 version and variant bits without native UUID support', () => {
  const randomValues = vi.fn((bytes: Uint8Array) => {
    bytes.fill(255);
    return bytes;
  });
  vi.stubGlobal('crypto', { getRandomValues: randomValues });
  const id = browserUuid();
  expect(uuidSchema.parse(id)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  expect(randomValues).toHaveBeenCalledOnce();
  expect(randomValues.mock.calls[0]?.[0].byteLength).toBe(16);
});
it('fails without an available cryptographic source and never generates a weak operation identifier', () => {
  vi.stubGlobal('crypto', undefined);
  expect(() => browserUuid()).toThrow();
  vi.stubGlobal('crypto', {});
  expect(() => browserUuid()).toThrow();
});
it('reuses an existing or restored proposal without allocating entropy or rewriting its guarded body', () => {
  const randomValues = vi.fn((bytes: Uint8Array) => {
    bytes.fill(41);
    return bytes;
  });
  vi.stubGlobal('crypto', { getRandomValues: randomValues });
  const draft = createDraft({
    key: 'operation-identity',
    fields: {},
    base: { database_epoch: known, expected_revision: 4, expected_config_revision: 9 },
  });
  const request = {
    path: '/projects/alpha/tasks',
    method: 'POST',
    payload: { kind: 'ordinary', title: 'Сохранить идентичность' },
  } as const;
  const original = proposalFor(draft, request);
  expect(randomValues).toHaveBeenCalledOnce();
  const restored = parseProposal(JSON.parse(JSON.stringify(original)));
  vi.stubGlobal('crypto', undefined);
  expect(proposalFor(draft, request, original)).toBe(original);
  const replay = proposalFor(draft, request, restored);
  expect(replay).toBe(restored);
  expect(replay.body).toBe(original.body);
  expect(replay.envelope).toEqual(original.envelope);
  expect(() =>
    proposalFor(
      draft,
      { ...request, payload: { ...request.payload, title: 'Новая операция' } },
      original,
    ),
  ).toThrow();
});
