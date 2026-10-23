import { afterEach, describe, expect, test } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod/mini';
import { listTasks } from '../../src/core/queries/tasks.js';
import { taskListInputSchema } from '../../src/schema/task-query.js';
import { createReadViewsFixture, type ReadViewsFixture } from '../fixtures/read-views.js';
const page = z.object({
  data: z.object({
    items: z.array(z.object({ id: z.uuid(), display_deadline: z.nullable(z.string()) })),
    next_cursor: z.nullable(z.string()),
  }),
  meta: z.object({ as_of: z.string() }),
});
let current: ReadViewsFixture | undefined;
afterEach(async () => {
  await current?.fixture.close();
  current = undefined;
});
describe('calendar task deadline filters', () => {
  test('today/from tomorrow/three days filter before pagination in project timezone without writes', async () => {
    current = await createReadViewsFixture();
    const f = current;
    const before = f.snapshot();
    const read = (deadline_preset: string) =>
      page.parse(
        listTasks(
          f.readContext,
          taskListInputSchema.parse({
            project_slug: 'classic',
            q: 'agenda:',
            deadline_preset,
            limit: 200,
            include_terminal: true,
          }),
        ),
      );
    const today = read('today').data.items.map((t) => t.id);
    expect(today).toContain(f.idsByMeaning.exact);
    expect(today).toContain(f.idsByMeaning.today_last);
    expect(today).not.toContain(f.idsByMeaning.next_start);
    expect(today).not.toContain(f.idsByMeaning.undated);
    const tomorrow = read('from_tomorrow').data.items.map((t) => t.id);
    expect(tomorrow).toContain(f.idsByMeaning.next_start);
    expect(tomorrow).not.toContain(f.idsByMeaning.today_last);
    expect(read('next_3_days').data.items.map((t) => t.id)).toContain(f.idsByMeaning.next_start);
    expect(read('undated').data.items.map((t) => t.id)).toContain(f.idsByMeaning.recurring_empty);
    expect(f.snapshot()).toEqual(before);
  });
  test('exact day and priority AND only match that day; invalid dates and both date modes are rejected', async () => {
    current = await createReadViewsFixture({ timezone: 'Europe/Moscow' });
    const f = current;
    const tomorrow = Temporal.Instant.fromEpochMilliseconds(f.asOf)
      .toZonedDateTimeISO('Europe/Moscow')
      .toPlainDate()
      .add({ days: 1 })
      .toString();
    const result = page.parse(
      listTasks(
        f.readContext,
        taskListInputSchema.parse({
          project_slug: 'classic',
          deadline_day: tomorrow,
          q: 'agenda:',
          limit: 200,
        }),
      ),
    );
    expect(result.data.items.map((t) => t.id)).toEqual([f.idsByMeaning.next_start]);
    expect(() =>
      taskListInputSchema.parse({ project_slug: 'classic', deadline_day: '2026-02-30' }),
    ).toThrow();
    expect(() =>
      taskListInputSchema.parse({
        project_slug: 'classic',
        deadline_day: tomorrow,
        deadline_preset: 'today',
      }),
    ).toThrow();
  });
  test('cursor freezes local relative day across midnight and rejects changed filter identity', async () => {
    current = await createReadViewsFixture({
      asOf: Date.parse('2026-10-21T20:59:59.999Z'),
      timezone: 'Europe/Moscow',
    });
    const f = current;
    const input = taskListInputSchema.parse({
      project_slug: 'classic',
      deadline_preset: 'today',
      limit: 1,
    });
    const first = page.parse(listTasks(f.readContext, input));
    expect(first.data.next_cursor).not.toBeNull();
    f.clock.set(f.asOf + 1);
    const next = page.parse(
      listTasks(f.readContext, { ...input, cursor: first.data.next_cursor ?? '' }),
    );
    expect(next.meta.as_of).toEqual(first.meta.as_of);
    expect(() =>
      listTasks(f.readContext, {
        ...input,
        deadline_preset: 'undated',
        cursor: first.data.next_cursor ?? '',
      }),
    ).toThrow();
  });
  test('calendar day spans DST using local midnight, and recurring uses earliest open occurrence', async () => {
    current = await createReadViewsFixture({
      asOf: Date.parse('2026-03-29T10:00:00Z'),
      timezone: 'Europe/Berlin',
    });
    const f = current;
    const result = page.parse(
      listTasks(
        f.readContext,
        taskListInputSchema.parse({
          project_slug: 'classic',
          deadline_day: '2026-03-29',
          q: 'agenda:',
          limit: 200,
          include_terminal: true,
        }),
      ),
    );
    expect(result.data.items.map((t) => t.id)).toContain(f.idsByMeaning.today_last);
    expect(result.data.items.map((t) => t.id)).not.toContain(f.idsByMeaning.next_start);
    const recurring = page.parse(
      listTasks(
        f.readContext,
        taskListInputSchema.parse({
          project_slug: 'classic',
          kind: 'recurring',
          deadline_preset: 'overdue',
          limit: 200,
        }),
      ),
    );
    expect(recurring.data.items.map((t) => t.id)).toContain(f.idsByMeaning.recurring_open);
  });
});
