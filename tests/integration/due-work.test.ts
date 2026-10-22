import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod/mini';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { generationFixture, readContext } from '../fixtures/recurrence-generations.js';
import {
  outcomeSnapshot,
  seedOccurrence,
  seedOutcomeParent,
} from '../fixtures/occurrence-outcomes.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';
type Discover = (
  context: ReturnType<typeof readContext>,
  slug: string,
  input?: Record<string, unknown>,
) => unknown;
async function discover() {
  const path = '../../src/core/queries/due-work.js';
  const loaded: unknown = await import(path);
  return z
    .object({ discoverDueWork: z.custom<Discover>((value) => typeof value === 'function') })
    .parse(loaded).discoverDueWork;
}
const envelope = z.extend(successEnvelopeSchema, {
  data: z.object({
    tasks: z.array(z.object({ task_id: z.uuid(), expected_revision: z.int().check(z.positive()) })),
    expected_config_revision: z.int().check(z.positive()),
    expected_settings_revision: z.int().check(z.positive()),
    has_more: z.boolean(),
  }),
});
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());
it('discovery uses strict captured expiry for paused parents and remains entirely pure', async () => {
  const query = await discover();
  const parent = seedOutcomeParent(fixture, { status: 'paused', window: 10 });
  const row = seedOccurrence(fixture, parent);
  fixture.clock.set(row.expires_at);
  expect(envelope.parse(query(readContext(fixture), 'alpha')).data.tasks).toEqual([]);
  fixture.clock.advanceBy(1);
  const before = outcomeSnapshot(fixture);
  const result = envelope.parse(query(readContext(fixture), 'alpha'));
  expect(result.data).toEqual({
    tasks: [{ task_id: parent.id, expected_revision: 1 }],
    expected_config_revision: 1,
    expected_settings_revision: 1,
    has_more: false,
  });
  expect(result.meta.database_epoch).toBe(fixture.epoch);
  expect(result.meta.now).toBe(new Date(fixture.clock.now()).toISOString());
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it('active calendar discovery requests one future anchor even when its next candidate is later than now', async () => {
  const query = await discover();
  const parent = seedOutcomeParent(fixture, { mode: 'calendar' });
  seedOccurrence(fixture, parent, { state: 'missed', key: `calendar:${parent.deadline}` });
  fixture.connection.sqlite
    .prepare('UPDATE recurrence_state SET next_candidate_at=? WHERE task_id=?')
    .run(parent.deadline + 86400000, parent.id);
  const before = outcomeSnapshot(fixture);
  expect(envelope.parse(query(readContext(fixture), 'alpha')).data.tasks).toEqual([
    { task_id: parent.id, expected_revision: 1 },
  ]);
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it('a precreated current future anchor suppresses extra work until its deadline, independently of recorded next candidate', async () => {
  const query = await discover();
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: fixture.clock.now() + 86400000,
  });
  seedOccurrence(fixture, parent, { key: `calendar:${parent.deadline}` });
  fixture.connection.sqlite
    .prepare('UPDATE recurrence_state SET next_candidate_at=? WHERE task_id=?')
    .run(parent.deadline + 86400000, parent.id);
  expect(envelope.parse(query(readContext(fixture), 'alpha')).data.tasks).toEqual([]);
  fixture.clock.set(parent.deadline);
  expect(
    envelope.parse(query(readContext(fixture), 'alpha')).data.tasks.map((task) => task.task_id),
  ).toEqual([parent.id]);
});
it('paused current calendar still exposes anchors owed before pause without scheduling paused-period work', async () => {
  const query = await discover();
  const now = fixture.clock.now();
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    status: 'paused',
    deadline: now - 3 * 86400000,
  });
  fixture.connection.sqlite
    .prepare('UPDATE recurrence_intervals SET start_at=? WHERE task_id=?')
    .run(now - 86400000, parent.id);
  fixture.connection.sqlite
    .prepare(
      'INSERT INTO recurrence_intervals(id,task_id,project_slug,start_at,end_at,behavior,schedule_generation_id) VALUES(?,?,?,?,?,?,?)',
    )
    .run(
      randomUUID(),
      parent.id,
      'alpha',
      parent.deadline,
      now - 86400000,
      'active',
      parent.generation,
    );
  fixture.connection.sqlite
    .prepare('UPDATE recurrence_state SET next_candidate_at=? WHERE task_id=?')
    .run(parent.deadline + 86400000, parent.id);
  expect(
    envelope.parse(query(readContext(fixture), 'alpha')).data.tasks.map((task) => task.task_id),
  ).toEqual([parent.id]);
  fixture.connection.sqlite
    .prepare('UPDATE recurrence_state SET cursor_anchor=?,next_candidate_at=? WHERE task_id=?')
    .run(now - 86400000, now, parent.id);
  expect(envelope.parse(query(readContext(fixture), 'alpha')).data.tasks).toEqual([]);
});
it('hidden parents/projects and drained completion-relative parents are excluded', async () => {
  const query = await discover();
  seedOutcomeParent(fixture);
  const hidden = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() - 100,
  });
  seedOccurrence(fixture, hidden);
  fixture.connection.sqlite
    .prepare('UPDATE tasks SET archived_at=? WHERE id=?')
    .run(fixture.clock.now(), hidden.id);
  expect(envelope.parse(query(readContext(fixture), 'alpha')).data.tasks).toEqual([]);
  fixture.connection.sqlite.prepare('UPDATE tasks SET archived_at=NULL WHERE id=?').run(hidden.id);
  fixture.connection.sqlite
    .prepare('UPDATE projects SET archived_at=? WHERE slug=?')
    .run(fixture.clock.now(), 'alpha');
  expect(envelope.parse(query(readContext(fixture), 'alpha')).data.tasks).toEqual([]);
});
it('bounded discovery returns current guards, stable candidates and has_more without silently dropping excess parents', async () => {
  const query = await discover();
  for (let index = 0; index < 3; index++) {
    const parent = seedOutcomeParent(fixture, {
      status: 'paused',
      deadline: fixture.clock.now() - 10 - index,
    });
    seedOccurrence(fixture, parent);
  }
  const before = outcomeSnapshot(fixture);
  const first = envelope.parse(query(readContext(fixture), 'alpha', { limit: 2 }));
  expect(first.data.tasks).toHaveLength(2);
  expect(first.data.has_more).toBe(true);
  expect(envelope.parse(query(readContext(fixture), 'alpha', { limit: 2 }))).toEqual(first);
  expect(
    envelope.parse(query(readContext(fixture), 'alpha', { limit: 3 })).data.tasks,
  ).toHaveLength(3);
  for (const input of [{ limit: 0 }, { limit: 129 }, { all_projects: true }, { now: 0 }])
    expect(() => query(readContext(fixture), 'alpha', input)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it('discovery batches parent associations without growing SQL statements per parent', async () => {
  const query = await discover();
  const addParent = () => {
    const parent = seedOutcomeParent(fixture, {
      status: 'paused',
      deadline: fixture.clock.now() - 10,
    });
    seedOccurrence(fixture, parent);
  };
  addParent();
  const prepared = vi.spyOn(fixture.connection.sqlite, 'prepare');
  try {
    expect(envelope.parse(query(readContext(fixture), 'alpha')).data.tasks).toHaveLength(1);
    const singleCount = prepared.mock.calls.length;
    prepared.mockRestore();
    for (let index = 0; index < 19; index++) addParent();
    const manyPrepared = vi.spyOn(fixture.connection.sqlite, 'prepare');
    try {
      const before = outcomeSnapshot(fixture);
      manyPrepared.mockClear();
      expect(envelope.parse(query(readContext(fixture), 'alpha')).data.tasks).toHaveLength(20);
      expect(manyPrepared.mock.calls).toHaveLength(singleCount);
      manyPrepared.mockRestore();
      expect(outcomeSnapshot(fixture)).toEqual(before);
    } finally {
      manyPrepared.mockRestore();
    }
  } finally {
    prepared.mockRestore();
  }
});
