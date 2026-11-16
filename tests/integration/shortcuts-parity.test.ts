import { afterEach, beforeEach, expect, it } from 'vitest';
import { completeOccurrences } from '../../src/core/recurrence/complete.js';
import { completeByDay } from '../../src/core/shortcuts/complete-by-day.js';
import { seedDay } from '../fixtures/occurrence-days.js';
import { outcomeInput, seedOutcomeParent } from '../fixtures/occurrence-outcomes.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';
import { auditRows, occurrenceState, refusal } from '../fixtures/shortcuts.js';

/** Spec 009 US3: a shortcut writes exactly what the strict form writes (FR-009, SC-003). */
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

it('occurrence done leaves the same audit trail as occurrence complete', () => {
  const window = 6 * 3600000;
  const strict = seedOutcomeParent(fixture, { policy: 'record_miss', window, emoji: '🌙' });
  const short = seedOutcomeParent(fixture, { policy: 'record_miss', window, emoji: '☀️' });
  const strictRow = seedDay(fixture, strict, '2026-11-08', 'pending');
  const shortRow = seedDay(fixture, short, '2026-11-08', 'pending');
  const before = auditRows(fixture).length;
  completeOccurrences(
    fixture.human,
    'alpha',
    strict.id,
    outcomeInput(fixture, strict.id, {
      occurrences: [
        { id: strictRow, expected_revision: occurrenceState(fixture, strictRow).revision },
      ],
    }),
  );
  const strictRows = auditRows(fixture).slice(before);
  completeByDay(fixture.human, 'alpha', { task: '☀️', day: '2026-11-08' });
  const shortRows = auditRows(fixture).slice(before + strictRows.length);
  const shape = (rows: typeof strictRows) =>
    rows.map((row) => ({
      action: row.action,
      entity_type: row.entity_type,
      changes: row.changes
        .replaceAll(strict.id, 'TASK')
        .replaceAll(short.id, 'TASK')
        .replaceAll(strictRow, 'ROW')
        .replaceAll(shortRow, 'ROW')
        .replaceAll(strict.generation, 'GEN')
        .replaceAll(short.generation, 'GEN')
        .replaceAll(/🌙|☀️/gu, 'E')
        // Successor occurrences get fresh identifiers in both forms.
        .replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, 'UUID'),
    }));
  expect(shape(shortRows)).toEqual(shape(strictRows));
  expect(new Set(shortRows.map((row) => row.operation_id)).size).toBe(1);
});

it('the strict path is unchanged: a replay returns the stored result, a changed payload conflicts (T002)', () => {
  const parent = seedOutcomeParent(fixture, {
    policy: 'record_miss',
    window: 3600000,
    emoji: '🌙',
  });
  const row = seedDay(fixture, parent, '2026-11-08', 'pending');
  const input = outcomeInput(fixture, parent.id, {
    occurrences: [{ id: row, expected_revision: occurrenceState(fixture, row).revision }],
  });
  const first = completeOccurrences(fixture.human, 'alpha', parent.id, input);
  const writes = auditRows(fixture).length;
  expect(completeOccurrences(fixture.human, 'alpha', parent.id, input)).toEqual(first);
  expect(auditRows(fixture)).toHaveLength(writes);
  const changed = { ...input, payload: { occurrences: [{ id: row, expected_revision: 99 }] } };
  expect(
    refusal(() => completeOccurrences(fixture.human, 'alpha', parent.id, changed)),
  ).toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
});
