import { afterEach, beforeEach, expect, it } from 'vitest';
import { completeByDay } from '../../src/core/shortcuts/complete-by-day.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { seedDay } from '../fixtures/occurrence-days.js';
import { seedOutcomeParent } from '../fixtures/occurrence-outcomes.js';
import { ordinaryInput, type OrdinaryFixture } from '../fixtures/ordinary-work.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';
import { auditRows, occurrenceState, refusal } from '../fixtures/shortcuts.js';

/** Spec 009 US1: complete an occurrence by task and day. */
const hour = 3600000;
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

function habit() {
  return seedOutcomeParent(fixture, { policy: 'record_miss', window: 6 * hour, emoji: '🌙' });
}
function done(input: Record<string, string>) {
  return completeByDay(fixture.human, 'alpha', input);
}

it('completes by icon and day with a note, with no tokens supplied (FR-001, FR-003, FR-004)', () => {
  const parent = habit();
  const id = seedDay(fixture, parent, '2026-11-08', 'pending');
  const result = done({ task: '🌙', day: '2026-11-08', note: 'время примерное' });
  expect(occurrenceState(fixture, id)).toMatchObject({
    state: 'completed',
    completion_note: 'время примерное',
  });
  expect(result).toMatchObject({ ok: true, meta: { operation_id: expect.any(String) } });
  // Follow-up data (FR-011): the strict envelope carries the parent revision and the epoch.
  expect(JSON.stringify(result.data)).toContain(parent.id);
  expect(result.meta.database_epoch).toBe(fixture.epoch);
  expect(auditRows(fixture).at(-1)?.action).toBe('occurrence.complete');
});

it('owed and missed rows complete as late; ordinary tasks are refused by kind', () => {
  const parent = habit();
  const owed = seedDay(fixture, parent, '2026-11-06', 'debt');
  const missed = seedDay(fixture, parent, '2026-11-07', 'missed');
  done({ task: parent.id, day: '2026-11-06' });
  done({ task: parent.id, day: '2026-11-07' });
  expect(occurrenceState(fixture, owed).state).toBe('completed_late');
  expect(occurrenceState(fixture, missed).state).toBe('completed_late');
  const ordinary = createTask(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { kind: 'ordinary', title: 'Обычная', emoji: '📕' }),
  );
  expect(refusal(() => done({ task: '📕', day: '2026-11-06' }))).toMatchObject({
    code: 'VALIDATION_ERROR',
    details: { kind: 'ordinary' },
  });
  expect(ordinary.ok).toBe(true);
});

it('a repeat returns the record; different data is refused with the stored record (FR-008)', () => {
  const parent = habit();
  const id = seedDay(fixture, parent, '2026-11-08', 'pending');
  done({ task: '🌙', day: '2026-11-08', note: 'первый раз' });
  const writes = auditRows(fixture).length;
  const repeat = done({ task: '🌙', day: '2026-11-08' });
  expect(repeat).toMatchObject({ ok: true, data: { id, existing: true } });
  expect(auditRows(fixture)).toHaveLength(writes);
  expect(refusal(() => done({ task: '🌙', day: '2026-11-08', note: 'другая' }))).toMatchObject({
    code: 'VALIDATION_ERROR',
    details: { existing: { id, completion_note: 'первый раз' } },
  });
  expect(auditRows(fixture)).toHaveLength(writes);
});

it('no match lists the nearest days; several matches list candidates (FR-005, SC-002)', () => {
  const parent = habit();
  seedDay(fixture, parent, '2026-11-03', 'pending');
  seedDay(fixture, parent, '2026-11-09', 'pending');
  expect(refusal(() => done({ task: '🌙', day: '2026-11-05' }))).toMatchObject({
    code: 'TASK_NOT_FOUND',
    details: { nearest_days: { earlier: '2026-11-03', later: '2026-11-09' } },
  });
  const second = seedDay(fixture, parent, '2026-11-09', 'pending');
  const several = refusal(() => done({ task: '🌙', day: '2026-11-09' }));
  expect(several).toMatchObject({
    code: 'VALIDATION_ERROR',
    details: { candidates: [expect.objectContaining({ state: 'pending' }), expect.anything()] },
  });
  done({ task: '🌙', occurrence: second });
  expect(occurrenceState(fixture, second).state).toBe('completed');
});

it('names: the default icon and an unknown icon are refused with the reserved icons', () => {
  habit();
  expect(refusal(() => done({ task: '⚪', day: '2026-11-08' }))).toMatchObject({
    code: 'VALIDATION_ERROR',
    details: { allowed: ['🌙'] },
  });
  expect(refusal(() => done({ task: '🦊', day: '2026-11-08' }))).toMatchObject({
    code: 'TASK_NOT_FOUND',
    details: { allowed: ['🌙'] },
  });
  expect(
    refusal(() => done({ task: '🌙', day: '2026-11-08', occurrence: crypto.randomUUID() })),
  ).toMatchObject({ code: 'VALIDATION_ERROR' });
});
