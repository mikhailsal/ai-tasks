import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod/mini';
import type { CoreContext } from '../../src/core/database/types.js';
import { createProject } from '../../src/core/projects/commands.js';
import { createTask } from '../../src/core/tasks/commands.js';
import {
  publishGeneration,
  requireRecurring,
  setRecurrenceBehavior,
} from '../../src/core/recurrence/generations.js';
import { tasks } from '../../src/schema/entities.js';
import {
  mutationSuccessEnvelopeSchema,
  type MutationEnvelope,
} from '../../src/schema/envelopes.js';
import { recurrenceInputSchema } from '../../src/schema/recurrence-input.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import {
  seedOutcomeParent,
  seedOccurrence,
  occurrenceRows,
  parentRevision,
  outcomeSnapshot,
  type OutcomeParent,
} from '../fixtures/occurrence-outcomes.js';
const day = 86400000;
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Обработка сроков', emoji: '⏱️' }),
  );
  createProject(
    fixture.human,
    'beta',
    ordinaryInput(
      fixture,
      { slug: 'beta', name: 'Другой проект', emoji: '🌲' },
      { projectSlug: 'beta' },
    ),
  );
});
afterEach(() => fixture?.close());
async function tickCommand() {
  const path = '../../src/core/recurrence/tick.js';
  const loaded: unknown = await import(path);
  const command = z
    .object({
      tickRecurrence: z.custom<
        (context: CoreContext, slug: string, input: MutationEnvelope) => unknown
      >((value) => typeof value === 'function'),
    })
    .parse(loaded).tickRecurrence;
  return (context: CoreContext, slug: string, input: MutationEnvelope) =>
    mutationSuccessEnvelopeSchema.parse(command(context, slug, input));
}
function tickInput(ids: string[]): MutationEnvelope {
  return {
    ...ordinaryInput(fixture, {
      tasks: ids.map((id) => ({ task_id: id, expected_revision: parentRevision(fixture, id) })),
    }),
    expected_settings_revision: 1,
  };
}
function calendarParent(daysAgo = 3, slug = 'alpha') {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    slug,
    deadline: fixture.clock.now() - daysAgo * day,
  });
  seedOccurrence(fixture, parent);
  fixture.connection.sqlite
    .prepare('UPDATE recurrence_state SET next_candidate_at=? WHERE task_id=?')
    .run(parent.deadline + day, parent.id);
  return parent;
}
function pauseParent(parent: OutcomeParent, at: number) {
  fixture.connection.db.transaction(
    (transaction) => {
      const task = requireRecurring(transaction, parent.slug, parent.id);
      setRecurrenceBehavior(transaction, {
        task,
        generationId: parent.generation,
        behavior: 'paused',
        now: at,
      });
      transaction.update(tasks).set({ statusId: 'paused' }).where(eq(tasks.id, parent.id)).run();
    },
    { behavior: 'immediate' },
  );
}
function auditRows(operation?: string) {
  return fixture.connection.sqlite
    .prepare(
      operation
        ? 'SELECT * FROM audit_records WHERE operation_id=? ORDER BY rowid'
        : "SELECT * FROM audit_records WHERE entity_type='occurrence' ORDER BY rowid",
    )
    .all(...(operation ? [operation] : []));
}
it('active calendar catch-up materializes all owed anchors and one future anchor, then repeated ticks deduplicate', async () => {
  const tick = await tickCommand();
  const parent = calendarParent();
  const result = tick(fixture.human, 'alpha', tickInput([parent.id]));
  const rows = occurrenceRows(fixture, parent.id);
  expect(rows.map((row) => row.deadline)).toEqual(
    [0, 1, 2, 3, 4].map((n) => parent.deadline + n * day),
  );
  expect(rows.filter((row) => row.deadline > fixture.clock.now())).toHaveLength(1);
  expect(rows.slice(0, 3).map((row) => row.state)).toEqual(['debt', 'debt', 'debt']);
  expect(rows[3]).toMatchObject({ state: 'pending', missed_at: null });
  expect(
    rows.every((row) => row.actual_completed_at === null && row.completion_recorded_at === null),
  ).toBe(true);
  const events = auditRows();
  expect(auditRows(result.meta.operation_id).length).toBe(result.meta.audit_ids.length);
  tick(fixture.human, 'alpha', tickInput([parent.id]));
  tick(fixture.human, 'alpha', tickInput([parent.id]));
  expect(occurrenceRows(fixture, parent.id)).toEqual(rows);
  expect(auditRows()).toEqual(events);
});
it('bounded ticks resume more than 128 owed anchors without dropping work, duplicate obligations or a total audit cap', async () => {
  const tick = await tickCommand();
  const parent = calendarParent(150);
  const first = tick(fixture.human, 'alpha', tickInput([parent.id]));
  expect(
    z
      .object({
        processed: z.int().check(z.minimum(1)).check(z.maximum(128)),
        has_more: z.literal(true),
      })
      .safeParse(first.data).success,
  ).toBe(true);
  expect(occurrenceRows(fixture, parent.id).length).toBeLessThan(152);
  for (let attempt = 0; attempt < 4; attempt++) {
    tick(fixture.human, 'alpha', tickInput([parent.id]));
    if (occurrenceRows(fixture, parent.id).some((row) => row.deadline > fixture.clock.now())) break;
  }
  const rows = occurrenceRows(fixture, parent.id);
  expect(rows).toHaveLength(152);
  expect(rows.map((row) => row.deadline)).toEqual(
    Array.from({ length: 152 }, (_, index) => parent.deadline + index * day),
  );
  expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  expect(new Set(rows.map((row) => row.occurrence_key)).size).toBe(rows.length);
  expect(rows.filter((row) => row.deadline > fixture.clock.now())).toHaveLength(1);
  expect(rows.filter((row) => row.state === 'debt')).toHaveLength(150);
  const events = auditRows();
  tick(fixture.human, 'alpha', tickInput([parent.id]));
  expect(occurrenceRows(fixture, parent.id)).toEqual(rows);
  expect(auditRows()).toEqual(events);
});
it.each(['carry_forward', 'record_miss'] as const)(
  'captured %s window expires strictly after endpoint with one miss event',
  async (policy) => {
    const tick = await tickCommand();
    const parent = seedOutcomeParent(fixture, { policy, window: 30000, status: 'paused' });
    const row = seedOccurrence(fixture, parent);
    fixture.clock.set(row.expires_at);
    tick(fixture.human, 'alpha', tickInput([parent.id]));
    expect(occurrenceRows(fixture, parent.id)).toEqual([row]);
    fixture.clock.advanceBy(1);
    const result = tick(fixture.human, 'alpha', tickInput([parent.id]));
    const expired = occurrenceRows(fixture, parent.id);
    expect(expired).toMatchObject([
      {
        id: row.id,
        state: policy === 'carry_forward' ? 'debt' : 'missed',
        revision: row.revision + 1,
        missed_at: row.expires_at,
        actual_completed_at: null,
      },
    ]);
    const recorded = z
      .array(z.object({ timestamp: z.number(), entity_id: z.string() }))
      .parse(auditRows(result.meta.operation_id));
    expect(recorded.filter((event) => event.entity_id === row.id)).toEqual([
      expect.objectContaining({ timestamp: fixture.clock.now() }),
    ]);
    const events = auditRows();
    tick(fixture.human, 'alpha', tickInput([parent.id]));
    expect(occurrenceRows(fixture, parent.id)).toEqual(expired);
    expect(auditRows()).toEqual(events);
  },
);
it('expiry honors old occurrence conditions after a paused replacement changes live policy and window', async () => {
  const tick = await tickCommand();
  const parent = seedOutcomeParent(fixture, { policy: 'carry_forward', window: 30000 });
  const row = seedOccurrence(fixture, parent);
  pauseParent(parent, fixture.clock.now());
  fixture.connection.db.transaction(
    (transaction) =>
      publishGeneration(transaction, {
        task: requireRecurring(transaction, 'alpha', parent.id),
        timezone: 'Europe/Moscow',
        now: fixture.clock.now(),
        entry: 'paused',
        input: recurrenceInputSchema.parse({
          first_deadline: new Date(fixture.clock.now() + day).toISOString(),
          schedule: parent.schedule,
          miss_policy: 'record_miss',
          confirmation_window_ms: 0,
        }),
      }),
    { behavior: 'immediate' },
  );
  fixture.clock.set(row.expires_at);
  tick(fixture.human, 'alpha', tickInput([parent.id]));
  expect(occurrenceRows(fixture, parent.id)).toEqual([row]);
  fixture.clock.advanceBy(1);
  tick(fixture.human, 'alpha', tickInput([parent.id]));
  expect(occurrenceRows(fixture, parent.id)).toMatchObject([
    {
      id: row.id,
      state: 'debt',
      missed_at: row.expires_at,
      schedule_snapshot: row.schedule_snapshot,
    },
  ]);
});
it('paused parent catches old active arrears but creates no obligations in the half-open paused period', async () => {
  const tick = await tickCommand();
  const parent = calendarParent(5);
  const now = fixture.clock.now();
  const pauseAt = parent.deadline + 2 * day + day / 2;
  pauseParent(parent, pauseAt);
  fixture.clock.set(now + 3 * day);
  tick(fixture.human, 'alpha', tickInput([parent.id]));
  const rows = occurrenceRows(fixture, parent.id);
  expect(rows.map((row) => row.deadline)).toEqual([0, 1, 2].map((n) => parent.deadline + n * day));
  expect(rows.every((row) => row.deadline < pauseAt && row.state === 'debt')).toBe(true);
  fixture.clock.advanceBy(10 * day);
  tick(fixture.human, 'alpha', tickInput([parent.id]));
  expect(occurrenceRows(fixture, parent.id)).toEqual(rows);
});
it('completion-relative ticks expire the existing seed but cannot synthesize completions or successor chains', async () => {
  const tick = await tickCommand();
  const parent = seedOutcomeParent(fixture, { deadline: fixture.clock.now() - 100 * day });
  const row = seedOccurrence(fixture, parent);
  for (let attempt = 0; attempt < 3; attempt++)
    tick(fixture.human, 'alpha', tickInput([parent.id]));
  expect(occurrenceRows(fixture, parent.id)).toMatchObject([
    { id: row.id, state: 'debt', actual_completed_at: null, completion_recorded_at: null },
  ]);
  expect(occurrenceRows(fixture, parent.id)).toHaveLength(1);
});
const invalidSelections = [
  'foreign-parent',
  'ordinary-parent',
  'stale-parent',
  'missing-parent',
  'duplicate',
  'empty',
] as const;
it.each(invalidSelections)(
  'tick validates all selected parents atomically: %s',
  async (invalid) => {
    const tick = await tickCommand();
    const valid = calendarParent();
    const second = calendarParent(2, invalid === 'foreign-parent' ? 'beta' : 'alpha');
    const claims = [valid, second].map((parent) => ({
      task_id: parent.id,
      expected_revision: parentRevision(fixture, parent.id),
    }));
    if (invalid === 'ordinary-parent' && claims[1]) {
      const ordinary = z
        .object({ id: z.uuid() })
        .parse(
          createTask(
            fixture.human,
            'alpha',
            ordinaryInput(fixture, { kind: 'ordinary', title: 'Обычная задача' }),
          ).data,
        );
      claims[1].task_id = ordinary.id;
    }
    if (invalid === 'stale-parent' && claims[1]) claims[1].expected_revision += 1;
    if (invalid === 'missing-parent' && claims[1]) claims[1].task_id = randomUUID();
    if (invalid === 'duplicate' && claims[0]) claims.push(claims[0]);
    if (invalid === 'empty') claims.length = 0;
    const input = { ...tickInput([valid.id]), payload: { tasks: claims } };
    const before = outcomeSnapshot(fixture);
    const expected =
      invalid === 'foreign-parent'
        ? 'PROJECT_MISMATCH'
        : invalid === 'stale-parent'
          ? 'REVISION_CONFLICT'
          : invalid === 'missing-parent'
            ? 'TASK_NOT_FOUND'
            : 'VALIDATION_ERROR';
    expect(() => tick(fixture.human, 'alpha', input)).toThrowError(
      expect.objectContaining({ code: expected }),
    );
    expect(outcomeSnapshot(fixture)).toEqual(before);
  },
);
const guardCases = [
  'epoch',
  'config',
  'settings',
  'missing-config',
  'missing-settings',
  'actor',
  'missing-project',
] as const;
it.each(guardCases)('tick rejects %s guard before writes', async (guard) => {
  const tick = await tickCommand();
  const parent = calendarParent();
  const input = tickInput([parent.id]);
  let context = fixture.human;
  let slug = 'alpha';
  let code = 'VALIDATION_ERROR';
  if (guard === 'epoch') {
    input.database_epoch = randomUUID();
    code = 'DATABASE_EPOCH_CONFLICT';
  }
  if (guard === 'config') {
    input.expected_config_revision = 2;
    code = 'CONFIG_CONFLICT';
  }
  if (guard === 'settings') {
    input.expected_settings_revision = 2;
    code = 'CONFIG_CONFLICT';
  }
  if (guard === 'missing-config') delete input.expected_config_revision;
  if (guard === 'missing-settings') delete input.expected_settings_revision;
  if (guard === 'actor') context = fixture.agent('beta');
  if (guard === 'missing-project') {
    slug = 'absent';
    code = 'PROJECT_NOT_FOUND';
  }
  const before = outcomeSnapshot(fixture);
  expect(() => tick(context, slug, input)).toThrowError(expect.objectContaining({ code }));
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it('tick exact replay precedes stale parent/config/settings guards but follows the current epoch', async () => {
  const tick = await tickCommand();
  const parent = calendarParent();
  const input = tickInput([parent.id]);
  const result = tick(fixture.human, 'alpha', input);
  expect(auditRows(result.meta.operation_id).length).toBe(result.meta.audit_ids.length);
  fixture.connection.sqlite
    .prepare('UPDATE application_state SET revision=revision+1 WHERE id=1')
    .run();
  const before = outcomeSnapshot(fixture);
  fixture.clock.advanceBy(day);
  expect(tick(fixture.human, 'alpha', input)).toEqual(result);
  expect(outcomeSnapshot(fixture)).toEqual(before);
  for (const changed of [
    { ...input, expected_settings_revision: 2 },
    {
      ...input,
      payload: {
        tasks: [{ task_id: parent.id, expected_revision: parentRevision(fixture, parent.id) + 1 }],
      },
    },
  ])
    expect(() => tick(fixture.human, 'alpha', changed)).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
    );
  expect(() => tick(fixture.agent('alpha'), 'alpha', input)).toThrowError(
    expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
  );
  expect(() => tick(fixture.human, 'beta', input)).toThrowError(
    expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
  fixture.connection.sqlite
    .prepare('UPDATE application_state SET database_epoch=? WHERE id=1')
    .run(randomUUID());
  const replaced = outcomeSnapshot(fixture);
  expect(() => tick(fixture.human, 'alpha', input)).toThrowError(
    expect.objectContaining({ code: 'DATABASE_EPOCH_CONFLICT' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(replaced);
});
it.each(['audit_records', 'operation_receipts'] as const)(
  'tick persistence failure at %s rolls back all selected parents and checkpoints',
  async (table) => {
    const tick = await tickCommand();
    const parents = [calendarParent(3), calendarParent(2)];
    const input = tickInput(parents.map((parent) => parent.id));
    const before = outcomeSnapshot(fixture);
    fixture.connection.sqlite.exec(`CREATE TRIGGER reject_tick_persistence BEFORE INSERT ON ${table}
    BEGIN SELECT RAISE(ABORT, 'injected tick persistence failure'); END`);
    expect(() => tick(fixture.human, 'alpha', input)).toThrow();
    expect(outcomeSnapshot(fixture)).toEqual(before);
    fixture.connection.sqlite.exec('DROP TRIGGER reject_tick_persistence');
    const result = tick(fixture.human, 'alpha', input);
    expect(auditRows(result.meta.operation_id).length).toBe(result.meta.audit_ids.length);
    const receipt = z
      .object({ result: z.string() })
      .parse(
        fixture.connection.sqlite
          .prepare('SELECT result FROM operation_receipts WHERE operation_id=?')
          .get(input.operation_id),
      );
    expect(JSON.parse(receipt.result)).toEqual(result);
    expect(parents.every((parent) => occurrenceRows(fixture, parent.id).length > 1)).toBe(true);
  },
);
