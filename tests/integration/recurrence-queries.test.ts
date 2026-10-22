import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod/mini';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { occurrencePageEnvelopeSchema } from '../../src/schema/recurrence-query.js';
import { occurrenceResource } from '../../src/core/recurrence/snapshots.js';
import { occurrences as occurrenceTable } from '../../src/schema/recurrence.js';
import { eq } from 'drizzle-orm';
import { createProject } from '../../src/core/projects/commands.js';
import { updateTask } from '../../src/core/tasks/commands.js';
import { configureRecurrence } from '../../src/core/recurrence/control.js';
import {
  generationFixture,
  generationInput,
  readContext,
} from '../fixtures/recurrence-generations.js';
import {
  outcomeSnapshot,
  recurrenceInput,
  seedOccurrence,
  seedOutcomeParent,
} from '../fixtures/occurrence-outcomes.js';
import { ordinaryInput, type OrdinaryFixture } from '../fixtures/ordinary-work.js';
type Context = ReturnType<typeof readContext>;
type ParentRead = (context: Context, slug: string, id: string) => unknown;
type OccurrenceRead = (context: Context, slug: string, parent: string, id: string) => unknown;
type ListRead = (
  context: Context,
  slug: string,
  parent: string,
  input?: Record<string, unknown>,
) => unknown;
async function queries() {
  const path = '../../src/core/queries/recurrence.js';
  const loaded: unknown = await import(path);
  return z
    .object({
      getRecurrence: z.custom<ParentRead>((value) => typeof value === 'function'),
      listOccurrences: z.custom<ListRead>((value) => typeof value === 'function'),
      getOccurrence: z.custom<OccurrenceRead>((value) => typeof value === 'function'),
    })
    .parse(loaded);
}
const pageSchema = z.extend(successEnvelopeSchema, {
  data: z.object({
    items: z.array(z.object({ id: z.string(), state: z.string() })),
    next_cursor: z.nullable(z.string()),
  }),
});
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());
it('recurrence/detail/list reads preserve expired stored pending outcomes and exact frozen resources', async () => {
  const api = await queries();
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() - 1000,
  });
  const seeded = seedOccurrence(fixture, parent);
  const stored = fixture.connection.db
    .select()
    .from(occurrenceTable)
    .where(eq(occurrenceTable.id, seeded.id))
    .get();
  if (!stored) throw new Error('Missing occurrence fixture');
  const before = outcomeSnapshot(fixture);
  const context = readContext(fixture);
  expect(
    successEnvelopeSchema.parse(api.getOccurrence(context, 'alpha', parent.id, seeded.id)).data,
  ).toEqual(occurrenceResource(stored));
  expect(pageSchema.parse(api.listOccurrences(context, 'alpha', parent.id)).data.items).toEqual([
    { id: seeded.id, state: 'pending' },
  ]);
  expect(
    successEnvelopeSchema.parse(api.getRecurrence(context, 'alpha', parent.id)).data,
  ).toMatchObject({
    task_id: parent.id,
    project_slug: 'alpha',
    task_revision: 1,
    config_revision: 1,
    settings_revision: 1,
    category: 'paused',
    display_deadline: new Date(parent.deadline).toISOString(),
    configuration: { generation_id: parent.generation, schedule: parent.schedule },
    checkpoint: { cursor_anchor: new Date(parent.deadline).toISOString() },
    occurrences: {
      pending: 1,
      debt: 0,
      missed: 0,
      completed: 0,
      completed_late: 0,
      cancelled: 0,
      total: 1,
    },
  });
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it('default occurrence pages retain every generation/outcome and exact state filtering', async () => {
  const api = await queries();
  const parent = seedOutcomeParent(fixture, { status: 'paused' });
  const pending = seedOccurrence(fixture, parent, { deadline: parent.deadline + 100 });
  const debt = seedOccurrence(fixture, parent, { state: 'debt', deadline: parent.deadline - 100 });
  const missed = seedOccurrence(fixture, parent, {
    state: 'missed',
    deadline: parent.deadline - 200,
  });
  configureRecurrence(
    fixture.human,
    'alpha',
    parent.id,
    generationInput(fixture, recurrenceInput(fixture.clock.now() + 10000), parent.id),
  );
  const context = readContext(fixture);
  expect(
    pageSchema
      .parse(api.listOccurrences(context, 'alpha', parent.id))
      .data.items.map((row) => row.id),
  ).toEqual([missed.id, debt.id, pending.id]);
  expect(
    pageSchema.parse(api.listOccurrences(context, 'alpha', parent.id, { state: 'debt' })).data
      .items,
  ).toEqual([{ id: debt.id, state: 'debt' }]);
  expect(
    pageSchema.parse(api.listOccurrences(context, 'alpha', parent.id, { state: 'completed' })).data
      .items,
  ).toEqual([]);
});
it('occurrence pagination preserves as_of across clock passage and rejects changed state/revision contexts', async () => {
  const api = await queries();
  const parent = seedOutcomeParent(fixture);
  for (let index = 0; index < 3; index++)
    seedOccurrence(fixture, parent, { deadline: parent.deadline + index });
  const context = readContext(fixture);
  const first = pageSchema.parse(api.listOccurrences(context, 'alpha', parent.id, { limit: 1 }));
  if (first.data.next_cursor === null) throw new Error('Expected next page');
  fixture.clock.advanceBy(10000);
  const next = pageSchema.parse(
    api.listOccurrences(context, 'alpha', parent.id, { limit: 1, cursor: first.data.next_cursor }),
  );
  expect(next.meta.as_of).toBe(first.meta.as_of);
  expect(next.meta.now).not.toBe(first.meta.now);
  expect(next.data.items[0]?.id).not.toBe(first.data.items[0]?.id);
  expect(() =>
    api.listOccurrences(context, 'alpha', parent.id, {
      limit: 1,
      state: 'pending',
      cursor: first.data.next_cursor,
    }),
  ).toThrow(expect.objectContaining({ code: 'CURSOR_STALE' }));
  updateTask(
    fixture.human,
    'alpha',
    parent.id,
    ordinaryInput(fixture, { title: 'Новое имя' }, { revision: 1 }),
  );
  expect(() =>
    api.listOccurrences(context, 'alpha', parent.id, { limit: 1, cursor: first.data.next_cursor }),
  ).toThrow(expect.objectContaining({ code: 'CURSOR_STALE' }));
});
it('archived history remains readable while explicit project and parent ownership stay enforced', async () => {
  const api = await queries();
  const parent = seedOutcomeParent(fixture);
  const other = seedOutcomeParent(fixture);
  const row = seedOccurrence(fixture, parent);
  createProject(
    fixture.human,
    'beta',
    ordinaryInput(fixture, { slug: 'beta', name: 'Другой', emoji: '🪐' }),
  );
  fixture.connection.sqlite
    .prepare('UPDATE tasks SET archived_at=? WHERE id=?')
    .run(fixture.clock.now(), parent.id);
  fixture.connection.sqlite
    .prepare('UPDATE projects SET archived_at=? WHERE slug=?')
    .run(fixture.clock.now(), 'alpha');
  const before = outcomeSnapshot(fixture);
  const context = readContext(fixture);
  expect(
    successEnvelopeSchema.parse(api.getOccurrence(context, 'alpha', parent.id, row.id)).ok,
  ).toBe(true);
  expect(successEnvelopeSchema.parse(api.getRecurrence(context, 'alpha', parent.id)).ok).toBe(true);
  expect(
    pageSchema.parse(api.listOccurrences(context, 'alpha', parent.id)).data.items,
  ).toHaveLength(1);
  expect(() => api.getOccurrence(context, 'alpha', other.id, row.id)).toThrow(
    expect.objectContaining({ code: 'PROJECT_MISMATCH' }),
  );
  expect(() => api.getRecurrence(context, 'beta', parent.id)).toThrow(
    expect.objectContaining({ code: 'PROJECT_MISMATCH' }),
  );
  expect(() => api.getOccurrence(context, 'alpha', parent.id, randomUUID())).toThrow(
    expect.objectContaining({ code: 'TASK_NOT_FOUND' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it('occurrence query boundaries reject invalid filters, unknown own keys and malformed cursors without writes', async () => {
  const api = await queries();
  const parent = seedOutcomeParent(fixture);
  const before = outcomeSnapshot(fixture);
  for (const input of [
    { state: 'late' },
    { limit: 201 },
    { limit: 0 },
    { now: 0 },
    { cursor: 'bad' },
    JSON.parse('{"__proto__":true}'),
  ]) {
    expect(() => api.listOccurrences(readContext(fixture), 'alpha', parent.id, input)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  }
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it('listing twenty occurrences retains parent associations with a fixed SQL statement count', async () => {
  const api = await queries();
  const parent = seedOutcomeParent(fixture);
  seedOccurrence(fixture, parent);
  function measuredRead() {
    const prepare = vi.spyOn(fixture.connection.sqlite, 'prepare');
    try {
      const result = occurrencePageEnvelopeSchema.parse(
        api.listOccurrences(readContext(fixture), 'alpha', parent.id, { limit: 200 }),
      );
      return { statements: prepare.mock.calls.length, result };
    } finally {
      prepare.mockRestore();
    }
  }
  const single = measuredRead();
  for (let index = 1; index < 20; index++)
    seedOccurrence(fixture, parent, { deadline: parent.deadline + index });
  const many = measuredRead();
  expect(single.statements).toBeGreaterThan(0);
  expect(many.statements).toBe(single.statements);
  expect(many.result.data.items).toHaveLength(20);
  for (const row of many.result.data.items)
    expect(row).toMatchObject({
      task_id: parent.id,
      project_slug: 'alpha',
      generation_id: parent.generation,
    });
});
