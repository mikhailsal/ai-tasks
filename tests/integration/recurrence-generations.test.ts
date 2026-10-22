import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { updateTask } from '../../src/core/tasks/commands.js';
import { invokeOrdinaryCli, type OrdinaryFixture } from '../fixtures/ordinary-work.js';
import {
  activate,
  asJson,
  checkpoint,
  createRecurring,
  daily,
  dayMs,
  elapsed,
  generationApi,
  generationRead,
  generationSettings,
  generationFixture,
  generationInput,
  generations,
  generationSnapshot,
  occurrences,
  readContext,
  rule,
  tickInput,
} from '../fixtures/recurrence-generations.js';
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());
it('compiled recurring task create accepts a valid explicit seed after a successful real meta control', () => {
  const control = invokeOrdinaryCli(fixture, ['meta', '--all-projects', '--json'], {});
  expect(control.error).toBeUndefined();
  expect(control.status).toBe(0);
  expect(control.stderr).toBe('');
  expect(JSON.parse(control.stdout)).toMatchObject({ ok: true, data: { contract_version: 1 } });
  const input = generationInput(fixture, {
    kind: 'recurring',
    title: 'Первый период',
    recurrence: rule(fixture.clock.now() - dayMs),
  });
  const { payload, ...envelope } = input;
  const result = invokeOrdinaryCli(
    fixture,
    ['task', 'create', '--project', 'alpha', '--json', '--input', '-'],
    asJson({ ...envelope, ...z.record(z.string(), z.json()).parse(payload) }),
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: true,
    data: { kind: 'recurring', status_id: 'draft' },
  });
});
it('draft stores the explicit schedule and immutable zone but never materializes work or advances on reads', async () => {
  const first = fixture.clock.now() - 3 * dayMs;
  const id = createRecurring(fixture, rule(first));
  const read = await generationRead();
  expect(generations(fixture, id)).toMatchObject([
    {
      generation_number: 1,
      first_deadline: first,
      timezone: 'Europe/Moscow',
    },
  ]);
  expect(JSON.parse(generations(fixture, id)[0]?.schedule ?? 'null')).toEqual(daily);
  expect(occurrences(fixture, id)).toEqual([]);
  expect(checkpoint(fixture, id).current_generation_id).toBe(generations(fixture, id)[0]?.id);
  const before = generationSnapshot(fixture);
  fixture.clock.advanceBy(10 * dayMs);
  read(readContext(fixture), 'alpha', id);
  read(readContext(fixture), 'alpha', id);
  expect(generationSnapshot(fixture)).toEqual(before);
});
it('initial activation honors a past seed exactly rather than deriving it from now or local_time', async () => {
  const first = fixture.clock.now() - dayMs + 12345;
  const id = createRecurring(fixture, rule(first));
  await activate(fixture, id);
  const seed = occurrences(fixture, id).find((row) => row.deadline === first);
  expect(seed).toBeDefined();
  expect(seed).toMatchObject({ actual_completed_at: null, completion_recorded_at: null });
  expect(occurrences(fixture, id).every((row) => row.actual_completed_at === null)).toBe(true);
  expect(generations(fixture, id)[0]?.first_deadline).toBe(first);
});
it('initial completion-relative activation and repeated ticks cannot invent an actual completion chain', async () => {
  const first = fixture.clock.now() - 10 * dayMs;
  const id = createRecurring(fixture, rule(first, { schedule: elapsed }));
  const api = await activate(fixture, id);
  for (let count = 0; count < 3; count++)
    api.tickRecurrence(fixture.human, 'alpha', tickInput(fixture, id));
  expect(occurrences(fixture, id)).toMatchObject([
    { deadline: first, actual_completed_at: null, completion_recorded_at: null },
  ]);
  expect(occurrences(fixture, id)).toHaveLength(1);
  expect(checkpoint(fixture, id).next_candidate_at).toBeNull();
});
it('active explicit restart publishes a new immutable generation and immediately seeds its future anchor', async () => {
  const first = fixture.clock.now() + dayMs;
  const id = createRecurring(fixture, rule(first));
  const api = await activate(fixture, id);
  const old = generations(fixture, id)[0];
  const oldOccurrences = occurrences(fixture, id);
  const next = first + 3 * dayMs;
  api.configureRecurrence(
    fixture.human,
    'alpha',
    id,
    generationInput(
      fixture,
      rule(next, { schedule: { ...daily, every: 2 }, policy: 'record_miss', window: 120000 }),
      id,
    ),
  );
  const rows = generations(fixture, id);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({ ...old, successor_generation_id: rows[1]?.id });
  expect(rows[1]).toMatchObject({
    generation_number: 2,
    first_deadline: next,
    miss_policy: 'record_miss',
    window_ms: 120000,
  });
  expect(checkpoint(fixture, id).current_generation_id).toBe(rows[1]?.id);
  expect(occurrences(fixture, id).filter((row) => row.generation_id === old?.id)).toEqual(
    oldOccurrences,
  );
  expect(occurrences(fixture, id)).toContainEqual(
    expect.objectContaining({ generation_id: rows[1]?.id, deadline: next }),
  );
});
it.each([-1, 0])(
  'active restart rejects a nonfuture seed (%d ms) without state, audit or receipt writes',
  async (delta) => {
    const id = createRecurring(fixture, rule(fixture.clock.now() + dayMs));
    const api = await activate(fixture, id);
    const before = generationSnapshot(fixture);
    expect(() =>
      api.configureRecurrence(
        fixture.human,
        'alpha',
        id,
        generationInput(fixture, rule(fixture.clock.now() + delta), id),
      ),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(generationSnapshot(fixture)).toEqual(before);
  },
);
it('restart rejects a same-parent existing occurrence deadline across generations atomically', async () => {
  const first = fixture.clock.now() + dayMs;
  const id = createRecurring(fixture, rule(first));
  const api = await activate(fixture, id);
  const before = generationSnapshot(fixture);
  expect(() =>
    api.configureRecurrence(
      fixture.human,
      'alpha',
      id,
      generationInput(fixture, rule(first, { policy: 'record_miss' }), id),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(generationSnapshot(fixture)).toEqual(before);
});
it('different parents may independently seed the same deadline', async () => {
  const first = fixture.clock.now() + dayMs;
  const left = createRecurring(fixture, rule(first));
  const right = createRecurring(fixture, rule(first));
  await activate(fixture, left);
  await activate(fixture, right);
  expect(occurrences(fixture, left).some((row) => row.deadline === first)).toBe(true);
  expect(occurrences(fixture, right).some((row) => row.deadline === first)).toBe(true);
});
it('paused calendar configuration creates a version without obligations arising in the paused period', async () => {
  // Keep the precreated old occurrence unexpired to isolate version creation from outcome expiry.
  const id = createRecurring(fixture, rule(fixture.clock.now() + dayMs, { window: 10 * dayMs }));
  const api = await activate(fixture, id);
  api.controlRecurrence(
    fixture.human,
    'alpha',
    id,
    generationInput(fixture, { to_status_id: 'paused' }, id),
  );
  const pauseAt = fixture.clock.now();
  fixture.clock.advanceBy(5 * dayMs);
  const old = occurrences(fixture, id);
  api.configureRecurrence(
    fixture.human,
    'alpha',
    id,
    generationInput(fixture, rule(pauseAt + 2 * dayMs), id),
  );
  const current = checkpoint(fixture, id).current_generation_id;
  expect(occurrences(fixture, id)).toEqual(old);
  api.controlRecurrence(
    fixture.human,
    'alpha',
    id,
    generationInput(fixture, { to_status_id: 'active' }, id),
  );
  const newlyCreated = occurrences(fixture, id).filter((row) => row.generation_id === current);
  expect(newlyCreated).toHaveLength(1);
  expect(newlyCreated[0]?.deadline).toBeGreaterThan(fixture.clock.now());
  expect(occurrences(fixture, id).filter((row) => row.generation_id !== current)).toEqual(old);
});
it('switching timing mode with open work rejects without rewriting earlier obligations', async () => {
  const id = createRecurring(fixture, rule(fixture.clock.now() + dayMs));
  const api = await activate(fixture, id);
  const before = generationSnapshot(fixture);
  expect(() =>
    api.configureRecurrence(
      fixture.human,
      'alpha',
      id,
      generationInput(fixture, rule(fixture.clock.now() + 2 * dayMs, { schedule: elapsed }), id),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(generationSnapshot(fixture)).toEqual(before);
});
it('switching timing mode with no occurrences in draft preserves first-anchor semantics without fake completion', async () => {
  const id = createRecurring(fixture, rule(fixture.clock.now() + dayMs));
  const api = await generationApi();
  const first = fixture.clock.now() + 3 * dayMs;
  api.configureRecurrence(
    fixture.human,
    'alpha',
    id,
    generationInput(fixture, rule(first, { schedule: elapsed }), id),
  );
  await activate(fixture, id);
  expect(generations(fixture, id).at(-1)).toMatchObject({
    mode: 'after_completion',
    first_deadline: first,
  });
  expect(occurrences(fixture, id)).toMatchObject([{ deadline: first, actual_completed_at: null }]);
  expect(occurrences(fixture, id)).toHaveLength(1);
});
it('old owed anchors are reconciled under their original generation before a future restart', async () => {
  const first = fixture.clock.now() + dayMs;
  const id = createRecurring(fixture, rule(first, { policy: 'record_miss', window: 0 }));
  const api = await activate(fixture, id);
  const oldId = generations(fixture, id)[0]?.id;
  fixture.clock.set(first + 3 * dayMs + 1);
  api.configureRecurrence(
    fixture.human,
    'alpha',
    id,
    generationInput(fixture, rule(fixture.clock.now() + dayMs), id),
  );
  const owed = occurrences(fixture, id).filter(
    (row) => row.generation_id === oldId && row.deadline <= fixture.clock.now(),
  );
  expect(owed.map((row) => row.deadline)).toEqual([
    first,
    first + dayMs,
    first + 2 * dayMs,
    first + 3 * dayMs,
  ]);
  expect(owed.every((row) => row.state === 'missed' && row.actual_completed_at === null)).toBe(
    true,
  );
  expect(checkpoint(fixture, id).current_generation_id).not.toBe(oldId);
});
it('late completion in a historical elapsed generation never produces a successor or changes the current checkpoint', async () => {
  const first = fixture.clock.now() - dayMs;
  const id = createRecurring(fixture, rule(first, { schedule: elapsed }));
  const api = await activate(fixture, id);
  const historical = occurrences(fixture, id)[0];
  expect(historical).toBeDefined();
  if (!historical) throw new Error('Missing initial occurrence');
  api.configureRecurrence(
    fixture.human,
    'alpha',
    id,
    generationInput(fixture, rule(fixture.clock.now() + dayMs, { schedule: elapsed }), id),
  );
  const current = checkpoint(fixture, id);
  api.completeOccurrences(
    fixture.human,
    'alpha',
    id,
    generationInput(
      fixture,
      {
        occurrences: [
          {
            id: historical.id,
            expected_revision: historical.revision,
            actual_completed_at: new Date(first + 1000).toISOString(),
          },
        ],
      },
      id,
    ),
  );
  expect(
    occurrences(fixture, id).filter((row) => row.generation_id === historical.generation_id),
  ).toHaveLength(1);
  expect(occurrences(fixture, id).find((row) => row.id === historical.id)?.state).toBe(
    'completed_late',
  );
  expect(checkpoint(fixture, id)).toEqual(current);
});
it('current elapsed completion yields exactly one backdated successor and exact replay cannot generate a chain', async () => {
  const first = fixture.clock.now() - 5 * dayMs;
  const id = createRecurring(
    fixture,
    rule(first, { schedule: elapsed, policy: 'record_miss', window: 0 }),
  );
  const api = await activate(fixture, id);
  const seed = occurrences(fixture, id)[0];
  if (!seed) throw new Error('Missing seed');
  const actual = first + 1234;
  const input = generationInput(
    fixture,
    {
      occurrences: [
        {
          id: seed.id,
          expected_revision: seed.revision,
          actual_completed_at: new Date(actual).toISOString(),
        },
      ],
    },
    id,
  );
  const result = api.completeOccurrences(fixture.human, 'alpha', id, input);
  const beforeReplay = generationSnapshot(fixture);
  expect(api.completeOccurrences(fixture.human, 'alpha', id, input)).toEqual(result);
  expect(generationSnapshot(fixture)).toEqual(beforeReplay);
  api.tickRecurrence(fixture.human, 'alpha', tickInput(fixture, id));
  const rows = occurrences(fixture, id);
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.id !== seed.id)).toMatchObject({
    occurrence_key: `after:${seed.id}`,
    deadline: actual + dayMs,
    state: 'missed',
    actual_completed_at: null,
    completion_recorded_at: null,
  });
});
it('raw source, rule, policy, window and original zone snapshots survive parent edits and future configuration', async () => {
  const first = fixture.clock.now() + dayMs;
  const id = createRecurring(fixture, rule(first));
  const api = await activate(fixture, id);
  const captured = occurrences(fixture, id)[0];
  if (!captured) throw new Error('Missing captured seed');
  const generation = generations(fixture, id)[0];
  expect(JSON.parse(captured.schedule_snapshot)).toMatchObject({
    generation_id: generation?.id,
    generation_number: 1,
    schedule: daily,
    first_deadline: new Date(first).toISOString(),
    timezone: 'Europe/Moscow',
    miss_policy: 'carry_forward',
    confirmation_window_ms: 60000,
  });
  updateTask(
    fixture.human,
    'alpha',
    id,
    generationInput(fixture, { description: '# Новый исходный текст' }, id),
  );
  api.configureRecurrence(
    fixture.human,
    'alpha',
    id,
    generationInput(
      fixture,
      rule(first + 2 * dayMs, {
        schedule: { ...daily, every: 2 },
        policy: 'record_miss',
        window: 0,
      }),
      id,
    ),
  );
  expect(occurrences(fixture, id).find((row) => row.id === captured.id)).toEqual(captured);
  expect(captured.description_snapshot).toBe('**Снимок** исходного текста');
});
it('timezone continuation retains old instants and begins strictly after effective change and prior materialized anchor', async () => {
  const first = fixture.clock.now() + dayMs;
  const id = createRecurring(fixture, rule(first, { policy: 'record_miss', window: 0 }));
  await activate(fixture, id);
  const original = occurrences(fixture, id);
  const oldId = generations(fixture, id)[0]?.id;
  const changedAt = fixture.clock.now();
  const updateSettings = await generationSettings();
  updateSettings(fixture.human, 'alpha', generationInput(fixture, { timezone: 'Europe/Berlin' }));
  const version = generations(fixture, id).at(-1);
  expect(version).toMatchObject({ generation_number: 2, timezone: 'Europe/Berlin' });
  expect(generations(fixture, id)[0]).toMatchObject({
    timezone: 'Europe/Moscow',
    successor_generation_id: version?.id,
  });
  expect(occurrences(fixture, id).filter((row) => row.generation_id === oldId)).toEqual(original);
  const continued = occurrences(fixture, id).filter((row) => row.generation_id === version?.id);
  expect(continued.length).toBeGreaterThan(0);
  expect(continued.every((row) => row.deadline > Math.max(first, changedAt))).toBe(true);
  expect(continued.every((row) => row.actual_completed_at === null)).toBe(true);
  expect(checkpoint(fixture, id).current_generation_id).toBe(version?.id);
});
it('timezone change reconciles old owed anchors using old local time before continuing in the new zone', async () => {
  const first = fixture.clock.now() + dayMs;
  const id = createRecurring(fixture, rule(first, { policy: 'record_miss', window: 0 }));
  await activate(fixture, id);
  const oldId = generations(fixture, id)[0]?.id;
  fixture.clock.set(first + 2 * dayMs + 1);
  const updateSettings = await generationSettings();
  updateSettings(fixture.human, 'alpha', generationInput(fixture, { timezone: 'Europe/Berlin' }));
  const oldOwed = occurrences(fixture, id).filter(
    (row) => row.generation_id === oldId && row.deadline <= fixture.clock.now(),
  );
  expect(oldOwed.map((row) => row.deadline)).toEqual([first, first + dayMs, first + 2 * dayMs]);
  expect(oldOwed.every((row) => row.state === 'missed' && row.actual_completed_at === null)).toBe(
    true,
  );
  expect(generations(fixture, id).at(-1)?.timezone).toBe('Europe/Berlin');
});
it('configure exact replay returns the original generation result before stale guards and makes no second version', async () => {
  const id = createRecurring(fixture, rule(fixture.clock.now() + dayMs));
  const api = await activate(fixture, id);
  const input = generationInput(fixture, rule(fixture.clock.now() + 4 * dayMs), id);
  const result = api.configureRecurrence(fixture.human, 'alpha', id, input);
  const snapshot = generationSnapshot(fixture);
  fixture.clock.advanceBy(1000);
  expect(asJson(api.configureRecurrence(fixture.human, 'alpha', id, input))).toEqual(
    asJson(result),
  );
  expect(generationSnapshot(fixture)).toEqual(snapshot);
});
