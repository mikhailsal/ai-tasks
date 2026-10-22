import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { auditEventSchema } from '../../src/core/audit/append.js';
import {
  materializeOccurrence,
  occurrenceEvent,
  occurrenceResource,
} from '../../src/core/recurrence/snapshots.js';
import { renderMarkdown, RENDER_POLICY_VERSION } from '../../src/core/markdown/render.js';
import { formatTimestamp } from '../../src/core/time.js';
import { tasks } from '../../src/schema/entities.js';
import { occurrences, scheduleGenerations } from '../../src/schema/recurrence.js';
import { generationFixture, generationSnapshot } from '../fixtures/recurrence-generations.js';
import { seedOutcomeParent, type OutcomeParent } from '../fixtures/occurrence-outcomes.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';

let fixture: OrdinaryFixture;
let parent: OutcomeParent;
beforeEach(async () => {
  fixture = await generationFixture();
  parent = seedOutcomeParent(fixture, { mode: 'calendar', window: 1_234 });
});
afterEach(() => fixture.close());

function rows() {
  const task = fixture.connection.db.select().from(tasks).where(eq(tasks.id, parent.id)).get();
  const generation = fixture.connection.db
    .select()
    .from(scheduleGenerations)
    .where(eq(scheduleGenerations.id, parent.generation))
    .get();
  if (!task || !generation) throw new Error('Missing real recurring storage setup');
  return { task, generation };
}
function materialize(key = 'calendar:seed', deadline = parent.deadline) {
  return fixture.connection.db.transaction(
    (transaction) =>
      materializeOccurrence(transaction, {
        ...rows(),
        key,
        deadline,
        now: fixture.clock.now(),
      }),
    { behavior: 'immediate' },
  );
}

it('captures full immutable generation conditions and exact source with pending outcome fields', () => {
  const { task, generation } = rows();
  const result = materialize();
  expect(result.row).toMatchObject({
    taskId: task.id,
    generationId: generation.id,
    state: 'pending',
    revision: 1,
    deadline: parent.deadline,
    expiresAt: parent.deadline + 1_234,
    descriptionSnapshot: task.description,
    descriptionHtmlSnapshot: task.descriptionHtml,
    renderPolicyVersion: RENDER_POLICY_VERSION,
    actualCompletedAt: null,
    completionRecordedAt: null,
    missedAt: null,
    cancelledAt: null,
    cancelReason: null,
  });
  expect(result.row.scheduleSnapshot).toEqual({
    generation_id: generation.id,
    generation_number: 1,
    schedule: parent.schedule,
    first_deadline: formatTimestamp(parent.deadline),
    timezone: 'Europe/Moscow',
    miss_policy: 'carry_forward',
    confirmation_window_ms: 1_234,
  });
  expect(result.events).toHaveLength(1);
  expect(auditEventSchema.parse(result.events[0])).toMatchObject({
    entity_type: 'occurrence',
    entity_id: result.row.id,
    action: 'occurrence.create',
    config_snapshot: result.row.scheduleSnapshot,
  });
  expect(result.events[0]?.changes).toContainEqual({
    field: 'description_snapshot',
    before: null,
    after: task.description,
  });
  expect(occurrenceResource(result.row)).toMatchObject({
    deadline: formatTimestamp(parent.deadline),
    expires_at: formatTimestamp(parent.deadline + 1_234),
    rendered_html_snapshot: task.descriptionHtml,
  });
  expect(occurrenceResource(result.row)).not.toHaveProperty('description_html_snapshot');
});

it('same generation and key returns original identity without another row or event', () => {
  const original = materialize();
  const before = generationSnapshot(fixture);
  fixture.clock.advanceBy(10_000);
  expect(materialize()).toEqual({ row: original.row, events: [] });
  expect(generationSnapshot(fixture)).toEqual(before);
});

it('same key with a different deadline rejects atomically', () => {
  materialize();
  const before = generationSnapshot(fixture);
  expect(() => materialize('calendar:seed', parent.deadline + 1)).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(generationSnapshot(fixture)).toEqual(before);
});

it('another key at the same parent deadline rejects even within the same generation', () => {
  materialize();
  const before = generationSnapshot(fixture);
  expect(() => materialize('calendar:another-key')).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(generationSnapshot(fixture)).toEqual(before);
});

it('a later generation cannot duplicate an existing parent deadline', () => {
  materialize();
  const { task, generation } = rows();
  const next = fixture.connection.db
    .insert(scheduleGenerations)
    .values({ ...generation, id: randomUUID(), generationNumber: 2 })
    .returning()
    .get();
  if (!next) throw new Error('Missing second real generation');
  const before = generationSnapshot(fixture);
  expect(() =>
    fixture.connection.db.transaction(
      (transaction) =>
        materializeOccurrence(transaction, {
          task,
          generation: next,
          key: 'calendar:new-generation',
          deadline: parent.deadline,
          now: fixture.clock.now(),
        }),
      { behavior: 'immediate' },
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(generationSnapshot(fixture)).toEqual(before);
});

it('expiry beyond supported year 9999 rejects before insertion and event creation', () => {
  const before = generationSnapshot(fixture);
  expect(() => materialize('calendar:overflow', Date.parse('9999-12-31T23:59:59.999Z'))).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(generationSnapshot(fixture)).toEqual(before);
});

it('obsolete task HTML cache is rendered safely without altering parent source or revision', () => {
  fixture.connection.sqlite
    .prepare('UPDATE tasks SET description_html=?, render_policy_version=? WHERE id=?')
    .run('<script>unsafe()</script>', RENDER_POLICY_VERSION + 1, parent.id);
  const task = rows().task;
  const result = materialize();
  expect(result.row.descriptionSnapshot).toBe(task.description);
  expect(result.row.descriptionHtmlSnapshot).toBe(renderMarkdown(task.description));
  expect(result.row.descriptionHtmlSnapshot).not.toContain('<script>');
  expect(result.row.renderPolicyVersion).toBe(RENDER_POLICY_VERSION);
  expect(rows().task).toEqual(task);
});

it('later source changes cannot rewrite a captured occurrence', () => {
  const original = materialize();
  fixture.connection.db
    .update(tasks)
    .set({
      description: '# Новый исходник',
      descriptionHtml: '<h1>Новый исходник</h1>\n',
      revision: 2,
    })
    .where(eq(tasks.id, parent.id))
    .run();
  const captured = fixture.connection.db
    .select()
    .from(occurrences)
    .where(eq(occurrences.id, original.row.id))
    .get();
  expect(captured).toEqual(original.row);
  expect(materialize()).toEqual({ row: original.row, events: [] });
});

it('a caller failure rolls back materialization in the existing immediate transaction', () => {
  const before = generationSnapshot(fixture);
  expect(() =>
    fixture.connection.db.transaction(
      (transaction) => {
        materializeOccurrence(transaction, {
          ...rows(),
          key: 'calendar:rollback',
          deadline: parent.deadline,
          now: fixture.clock.now(),
        });
        throw new Error('later mutation failure');
      },
      { behavior: 'immediate' },
    ),
  ).toThrow('later mutation failure');
  expect(generationSnapshot(fixture)).toEqual(before);
});

it('outcome events compare canonical public fields including every actual and recording timestamp', () => {
  const before = materialize().row;
  fixture.clock.set(before.expiresAt + 1);
  const now = fixture.clock.now();
  const after = fixture.connection.db
    .update(occurrences)
    .set({
      state: 'completed_late',
      revision: 2,
      actualCompletedAt: now - 1_000,
      completionRecordedAt: now,
      missedAt: before.expiresAt,
    })
    .where(eq(occurrences.id, before.id))
    .returning()
    .get();
  if (!after) throw new Error('Missing updated occurrence');
  const event = occurrenceEvent(before, after, 'occurrence.complete_late');
  expect(auditEventSchema.parse(event)).toMatchObject({
    config_snapshot: before.scheduleSnapshot,
    action: 'occurrence.complete_late',
  });
  expect(event.changes).toEqual(
    expect.arrayContaining([
      { field: 'state', before: 'pending', after: 'completed_late' },
      { field: 'revision', before: 1, after: 2 },
      { field: 'actual_completed_at', before: null, after: formatTimestamp(now - 1_000) },
      { field: 'completion_recorded_at', before: null, after: formatTimestamp(now) },
      { field: 'missed_at', before: null, after: formatTimestamp(before.expiresAt) },
    ]),
  );
  expect(event.changes).toHaveLength(5);
});

it('elapsed successors with distinct predecessor keys can share the same derived deadline', () => {
  const elapsedParent = seedOutcomeParent(fixture, { mode: 'after_completion' });
  const task = fixture.connection.db
    .select()
    .from(tasks)
    .where(eq(tasks.id, elapsedParent.id))
    .get();
  const generation = fixture.connection.db
    .select()
    .from(scheduleGenerations)
    .where(eq(scheduleGenerations.id, elapsedParent.generation))
    .get();
  if (!task || !generation) throw new Error('Missing elapsed storage setup');
  const results = fixture.connection.db.transaction(
    (transaction) => {
      const first = materializeOccurrence(transaction, {
        task,
        generation,
        key: `after:${randomUUID()}`,
        deadline: elapsedParent.deadline,
        now: fixture.clock.now(),
      });
      const second = materializeOccurrence(transaction, {
        task,
        generation,
        key: `after:${randomUUID()}`,
        deadline: elapsedParent.deadline,
        now: fixture.clock.now(),
      });
      return [first, second];
    },
    { behavior: 'immediate' },
  );
  expect(results).toHaveLength(2);
  expect(results[0]?.row.id).not.toBe(results[1]?.row.id);
  expect(results.map((result) => result.row.deadline)).toEqual([
    elapsedParent.deadline,
    elapsedParent.deadline,
  ]);
  expect(
    results.every((result) => result.row.actualCompletedAt === null && result.events.length === 1),
  ).toBe(true);
});
