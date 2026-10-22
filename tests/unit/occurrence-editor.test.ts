import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createDraft, parseProposal, updateDraft } from '../../web/src/data/drafts.js';
import {
  cancellationAllowed,
  completionPayload,
  occurrenceFieldsSchema,
} from '../../web/src/screens/occurrence-model.js';
import { projectResourceSchema } from '../../src/schema/projects.js';
import { settingsAttributionBase } from '../../web/src/screens/settings-model.js';
import { occurrenceProposal } from '../../web/src/screens/occurrence-proposal.js';

const id = randomUUID();
const base = {
  database_epoch: randomUUID(),
  expected_revision: 4,
  expected_config_revision: 2,
  expected_settings_revision: 7,
};
function fields() {
  return occurrenceFieldsSchema.parse({
    timezone: 'Europe/Moscow',
    reason: '',
    selected: [
      {
        id,
        revision: 3,
        state: 'debt',
        deadline: '2026-10-20T10:00:00.000Z',
        date: '',
        time: '',
        offset: '',
      },
    ],
  });
}
it('completion selects exactly source IDs and revisions and leaves an empty actual time to the server', () => {
  const value = fields();
  const unselected = randomUUID();
  const payload = completionPayload(value, value.timezone);
  expect(payload).toEqual({ occurrences: [{ id, expected_revision: 3 }] });
  expect(JSON.stringify(payload)).not.toContain(unselected);
  expect(JSON.stringify(payload)).not.toContain('actual_completed_at');
});
it('stored actual-time fields retain their original timezone and exact instant after another zone becomes current', () => {
  const value = fields();
  value.selected[0] = {
    ...value.selected[0],
    id,
    revision: 3,
    state: 'debt',
    deadline: '2026-10-20T10:00:00.000Z',
    date: '2026-10-21',
    time: '13:02:03.123',
    offset: '',
  };
  const record = createDraft({ key: 'occurrences:alpha:task', fields: value, base });
  const edited = updateDraft(record, { ...record.fields, reason: 'Точный источник' });
  const request = occurrenceProposal(edited, 'complete', '/projects/alpha/tasks/task/occurrences');
  expect(request.envelope.payload).toEqual({
    occurrences: [{ id, expected_revision: 3, actual_completed_at: '2026-10-21T10:02:03.123Z' }],
  });
  expect(edited.base).toEqual(base);
  expect(edited.fields.timezone).toBe('Europe/Moscow');
  const restored = parseProposal(structuredClone(request));
  expect(restored.body).toBe(request.body);
  expect(restored.envelope.operation_id).toBe(request.envelope.operation_id);
});
it('a partially entered actual time cannot silently become server now', () => {
  const value = fields();
  const selected = value.selected[0];
  if (!selected) throw new Error('Missing selected row');
  selected.date = '2026-10-21';
  expect(() => completionPayload(value, value.timezone)).toThrow();
});
it('ambiguous actual time requires explicit offset and nonexistent actual time requires correction', () => {
  const value = fields();
  value.timezone = 'America/New_York';
  const selected = value.selected[0];
  if (!selected) throw new Error('Missing selected row');
  Object.assign(selected, { date: '2026-11-01', time: '01:30:00.123' });
  expect(() => completionPayload(value, value.timezone)).toThrow('Выберите смещение');
  selected.offset = '-05:00';
  expect(completionPayload(value, value.timezone).occurrences[0]).toMatchObject({
    actual_completed_at: '2026-11-01T06:30:00.123Z',
  });
  Object.assign(selected, { date: '2026-03-08', time: '02:30:00.000', offset: '' });
  expect(() => completionPayload(value, value.timezone)).toThrow('не существует');
});
it('cancel eligibility is strict future pending on a paused parent, across explicitly selected pages', () => {
  const pending = {
    ...fields().selected[0],
    id,
    revision: 3,
    state: 'pending' as const,
    deadline: '2026-10-21T10:00:00.000Z',
    date: '',
    time: '',
    offset: '',
  };
  const next = { ...pending, id: randomUUID() };
  expect(cancellationAllowed([pending, next], 'paused', '2026-10-21T09:59:59.999Z')).toBe(true);
  expect(cancellationAllowed([pending], 'paused', pending.deadline)).toBe(false);
  expect(cancellationAllowed([pending], 'active', '2026-10-21T09:00:00.000Z')).toBe(false);
  expect(
    cancellationAllowed(
      [pending, { ...next, state: 'debt' }],
      'paused',
      '2026-10-21T09:00:00.000Z',
    ),
  ).toBe(false);
  expect(cancellationAllowed([], 'paused', '2026-10-21T09:00:00.000Z')).toBe(false);
});
it('cancellation preserves exact reason and selected revision while omitting inapplicable settings and actual-time fields', () => {
  const value = fields();
  value.reason = '  Причина\nбез переписывания  ';
  const draft = createDraft({ key: 'occurrences:alpha:task', fields: value, base });
  const request = occurrenceProposal(draft, 'cancel', '/projects/alpha/tasks/task/occurrences');
  expect(request.envelope).not.toHaveProperty('expected_settings_revision');
  expect(request.envelope).toMatchObject({
    expected_revision: 4,
    expected_config_revision: 2,
    payload: { occurrences: [{ id, expected_revision: 3 }], reason: value.reason },
  });
  expect(draft.base.expected_settings_revision).toBe(7);
});

it('choosing another attribution project changes only its config guard and retains original epoch/settings source', () => {
  const project = projectResourceSchema.parse({
    slug: 'beta',
    name: 'Архивный',
    description: '',
    emoji: '🌳',
    priority: 0,
    archived_at: '2026-10-21T10:00:00.000Z',
    revision: 20,
    config_revision: 9,
    created_at: '2026-10-21T09:00:00.000Z',
    updated_at: '2026-10-21T10:00:00.000Z',
  });
  const original = {
    database_epoch: randomUUID(),
    expected_settings_revision: 3,
    expected_config_revision: 2,
  };
  const attributed = settingsAttributionBase(original, project);
  expect(attributed).toEqual({ ...original, expected_config_revision: 9 });
  expect(original.expected_config_revision).toBe(2);
  expect(attributed).not.toHaveProperty('expected_revision');
});
