import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mutationEnvelopeSchema } from '../../src/schema/envelopes.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import {
  createDraft,
  deleteDraft,
  deleteProposal,
  loadDraft,
  loadProposal,
  parseProposal,
  proposalFor,
  reconcileDraft,
  saveDraft,
  saveProposal,
  updateDraft,
} from '../../web/src/data/drafts.js';

const base = {
  database_epoch: randomUUID(),
  expected_revision: 7,
  expected_config_revision: 3,
};
const path = '/projects/alpha/tasks/00000000-0000-4000-8000-000000000001';
const method = 'PATCH';

describe('separate browser drafts and immutable operation proposals', () => {
  it('clones source and original preconditions without changing whitespace or Unicode', () => {
    const source = '## План\n\n  Исходный текст 👩🏽‍💻\n';
    const fields = { description: source, nested: { selected: ['🧪'] } };
    const originalBase = { ...base };
    const draft = createDraft({ key: 'alpha:task', fields, base: originalBase });
    fields.description = 'Changed outside';
    fields.nested.selected.push('🎯');
    originalBase.expected_revision = 20;
    expect(draft.fields).toEqual({ description: source, nested: { selected: ['🧪'] } });
    expect(draft.base).toEqual(base);
    expect(Object.isFrozen(draft)).toBe(true);
    expect(Object.isFrozen(draft.fields.nested.selected)).toBe(true);
    expect(Object.isFrozen(draft.base)).toBe(true);
  });

  it('changes fields without silently rebasing and reconciles only when explicitly called', () => {
    const draft = createDraft({ key: 'alpha:task', fields: { description: 'Original' }, base });
    const edited = updateDraft(draft, { description: 'My unsaved text' });
    const newBase = { ...base, expected_revision: 8, expected_config_revision: 4 };
    expect(edited.base).toEqual(base);
    expect(draft.fields.description).toBe('Original');
    const reconciled = reconcileDraft(edited, newBase);
    expect(reconciled.fields).toEqual(edited.fields);
    expect(reconciled.base).toEqual(newBase);
    expect(edited.base).toEqual(base);
  });

  it('reuses the exact proposal and serialized body after an uncertain response', () => {
    const draft = createDraft({ key: 'alpha:task', fields: { description: 'Proposal' }, base });
    const payload = { description: 'Proposal', nested: { a: 1, b: ['x', 'y'] } };
    const proposal = proposalFor(draft, { path, method, payload });
    payload.description = 'Changed outside';
    payload.nested.b.reverse();
    const retry = proposalFor(
      draft,
      { path, method, payload: { nested: { b: ['x', 'y'], a: 1 }, description: 'Proposal' } },
      proposal,
    );
    expect(retry).toBe(proposal);
    expect(retry.body).toBe(proposal.body);
    expect(mutationEnvelopeSchema.parse(JSON.parse(retry.body))).toEqual(proposal.envelope);
    expect(Object.isFrozen(proposal.envelope.payload)).toBe(true);
    expect(proposal.envelope.payload).toEqual({
      description: 'Proposal',
      nested: { a: 1, b: ['x', 'y'] },
    });
  });

  it('gives changed payload, array order, path, method or preconditions a new operation ID', () => {
    const draft = createDraft({ key: 'alpha:task', fields: {}, base });
    const payload = { description: 'A', selection: [1, 2] };
    const original = proposalFor(draft, { path, method, payload });
    const changes = [
      proposalFor(draft, { path, method, payload: { ...payload, description: 'B' } }, original),
      proposalFor(draft, { path, method, payload: { ...payload, selection: [2, 1] } }, original),
      proposalFor(draft, { path: `${path}/restore`, method, payload }, original),
      proposalFor(draft, { path, method: 'POST', payload }, original),
      proposalFor(
        reconcileDraft(draft, { ...base, expected_revision: 8 }),
        { path, method, payload },
        original,
      ),
      proposalFor(
        reconcileDraft(draft, { ...base, database_epoch: randomUUID() }),
        { path, method, payload },
        original,
      ),
    ];
    expect(new Set(changes.map((proposal) => proposal.envelope.operation_id)).size).toBe(6);
    for (const changed of changes) {
      expect(changed.envelope.operation_id).not.toBe(original.envelope.operation_id);
    }
  });

  it('preserves own __proto__ keys and distinguishes nested JSON values', () => {
    const fields = jsonValueSchema.parse(JSON.parse('{"__proto__":{"text":"original"}}'));
    const draft = createDraft({ key: 'alpha:new', fields, base });
    const first = proposalFor(draft, { path, method, payload: fields });
    if (draft.fields === null || typeof draft.fields !== 'object')
      throw new Error('Expected object');
    expect(Object.hasOwn(draft.fields, '__proto__')).toBe(true);
    expect(JSON.parse(first.body)).toHaveProperty('payload');
    const changed = jsonValueSchema.parse(JSON.parse('{"__proto__":{"text":"changed"}}'));
    const next = proposalFor(draft, { path, method, payload: changed }, first);
    expect(next.envelope.operation_id).not.toBe(first.envelope.operation_id);
    expect(JSON.stringify(first.envelope.payload)).toBe('{"__proto__":{"text":"original"}}');
  });

  it('rejects unsafe field objects without executing accessors or repairing strings', () => {
    let reads = 0;
    const fields = {
      get description() {
        reads += 1;
        return 'Not JSON';
      },
    };
    expect(() => createDraft({ key: 'bad', fields, base })).toThrow();
    expect(reads).toBe(0);
    expect(() =>
      createDraft({ key: 'bad', fields: { description: String.fromCharCode(0xd800) }, base }),
    ).toThrow();
    expect(() =>
      createDraft({ key: 'bad', fields: {}, base: { database_epoch: 'invalid' } }),
    ).toThrow();
    expect(() => createDraft({ key: '', fields: {}, base })).toThrow();
  });

  it('omits undefined optional preconditions and rejects oversized proposal bodies', () => {
    const draft = createDraft({
      key: 'alpha:new',
      fields: {},
      base: { database_epoch: base.database_epoch, expected_revision: undefined },
    });
    const proposal = proposalFor(draft, { path, method, payload: {} });
    expect(Object.hasOwn(proposal.envelope, 'expected_revision')).toBe(false);
    expect(() =>
      proposalFor(draft, { path, method, payload: { description: 'x'.repeat(1_048_576) } }),
    ).toThrow();
    expect(() => proposalFor(draft, { path: '//other.test', method, payload: {} })).toThrow();
  });

  it('surfaces unavailable browser storage without losing the in-memory draft', async () => {
    const draft = createDraft({ key: 'alpha:task', fields: { description: 'Still here' }, base });
    await expect(saveDraft(draft)).rejects.toThrow('Не удалось сохранить черновик');
    await expect(loadDraft(draft.key)).rejects.toThrow('Не удалось прочитать черновик');
    await expect(deleteDraft(draft.key)).rejects.toThrow('Не удалось удалить');
    expect(draft.fields.description).toBe('Still here');
    expect(draft.base).toEqual(base);
  });

  it('restores a proposal from serialized storage with exactly its original ID and request body', () => {
    const draft = createDraft({ key: 'alpha:new', fields: {}, base });
    const payload = jsonValueSchema.parse(JSON.parse('{"__proto__":{"source":"  План 👩🏽‍💻\\n"}}'));
    const original = proposalFor(draft, { path, method, payload });
    const storageValue: unknown = JSON.parse(JSON.stringify(original));
    const restored = parseProposal(storageValue);
    expect(restored.envelope).toEqual(original.envelope);
    expect(restored.envelope.operation_id).toBe(original.envelope.operation_id);
    expect(restored.body).toBe(original.body);
    expect(JSON.stringify(restored.envelope.payload)).toBe(JSON.stringify(payload));
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.envelope.payload)).toBe(true);
    expect(proposalFor(draft, { path, method, payload }, restored)).toBe(restored);
  });

  it('rejects corrupt persisted proposal identities, paths and request bodies', () => {
    const draft = createDraft({ key: 'alpha:new', fields: {}, base });
    const original = proposalFor(draft, { path, method, payload: { description: 'Original' } });
    expect(() => parseProposal({ ...original, body: '{broken' })).toThrow();
    expect(() =>
      parseProposal({
        ...original,
        body: JSON.stringify({ ...original.envelope, operation_id: randomUUID() }),
      }),
    ).toThrow();
    expect(() =>
      parseProposal({
        ...original,
        body: JSON.stringify({ ...original.envelope, payload: { description: 'Different' } }),
      }),
    ).toThrow();
    expect(() => parseProposal({ ...original, path: '//other.test' })).toThrow();
    expect(() => parseProposal({ ...original, method: 'GET' })).toThrow();
    expect(() =>
      parseProposal({ ...original, body: `${' '.repeat(1_048_576)}${original.body}` }),
    ).toThrow();
  });

  it('surfaces proposal storage failure without sending or changing the pending operation', async () => {
    const draft = createDraft({ key: 'alpha:new', fields: {}, base });
    const proposal = proposalFor(draft, { path, method, payload: {} });
    const operationId = proposal.envelope.operation_id;
    await expect(saveProposal(draft.key, proposal)).rejects.toThrow('Не удалось сохранить запрос');
    await expect(loadProposal(draft.key)).rejects.toThrow(
      'Не удалось прочитать сохранённый запрос',
    );
    await expect(deleteProposal(draft.key)).rejects.toThrow(
      'Не удалось удалить сохранённый запрос',
    );
    expect(proposal.envelope.operation_id).toBe(operationId);
  });
});
