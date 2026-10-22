import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { priorityModelSchema, priorityValueSchema } from '../../src/schema/configuration.js';
import type { JsonValue } from '../../src/schema/values.js';
import { updateTask } from '../../src/core/tasks/commands.js';
import { listTasks } from '../../src/core/queries/tasks.js';
import { ordinaryInput } from '../fixtures/ordinary-work.js';
import { createReadViewsFixture, type ReadViewsFixture } from '../fixtures/read-views.js';
let view: ReadViewsFixture;
beforeEach(async () => {
  view = await createReadViewsFixture();
});
afterEach(() => view?.fixture.close());
const taskProjection = z.object({
  id: z.uuid(),
  project_slug: z.string(),
  kind: z.string(),
  status_id: z.string(),
  category: z.string(),
  deadline: z.nullable(z.string()),
  display_deadline: z.nullable(z.string()),
  priority: priorityValueSchema,
  agenda_bucket: z.optional(z.enum(['overdue', 'today', 'next_7_days', 'later', 'no_deadline'])),
});
const projectProjection = z.object({
  slug: z.string(),
  name: z.string(),
  emoji: z.string(),
  priority: z.number(),
  archived_at: z.nullable(z.string()),
  config_revision: z.number(),
});
const groupedEnvelope = z.extend(successEnvelopeSchema, {
  data: z.object({
    groups: z.array(
      z.object({
        project: projectProjection,
        priority_model: priorityModelSchema,
        ordinary_statuses: z.array(
          z.object({ id: z.string(), label: z.string(), category: z.string() }),
        ),
        recurring_statuses: z.array(
          z.object({ id: z.string(), label: z.string(), category: z.string() }),
        ),
        items: z.array(taskProjection),
      }),
    ),
    next_cursor: z.nullable(z.string()),
  }),
});
type Grouped = z.infer<typeof groupedEnvelope>;
type ReadCall = (
  context: ReadViewsFixture['readContext'],
  input: Record<string, JsonValue>,
) => unknown;
async function groupedApi(kind: 'agenda' | 'priorities') {
  const path =
    kind === 'agenda' ? '../../src/core/queries/agenda.js' : '../../src/core/queries/priorities.js';
  const loaded: unknown = await import(path);
  const name = kind === 'agenda' ? 'listAgenda' : 'listPriorities';
  const exports = z.record(z.string(), z.unknown()).parse(loaded);
  const read = z.custom<ReadCall>((value) => typeof value === 'function').parse(exports[name]);
  return (input: Record<string, JsonValue>) => groupedEnvelope.parse(read(view.readContext, input));
}
function id(meaning: string) {
  const value = view.idsByMeaning[meaning];
  if (!value) throw new Error(`Missing fixture meaning: ${meaning}`);
  return value;
}
function items(page: Grouped) {
  return page.data.groups.flatMap((group) => group.items);
}
function buckets(page: Grouped) {
  return Object.fromEntries(items(page).map((task) => [task.id, task.agenda_bucket]));
}
function selectedIds(meanings: string[]) {
  return meanings.map(id);
}
it('[ready] ties use deadline, missing-last, creation, UUID and both SQL/JSON null remain unset', () => {
  const before = view.snapshot();
  expect(
    listTasks(view.readContext, { project_slug: 'classic', q: 'tie:' }).data.items.map(
      (task) => task.id,
    ),
  ).toEqual(selectedIds(['tie_deadline', 'tie_old', 'tie_id_early', 'tie_id_late', 'tie_missing']));
  const unset = listTasks(view.readContext, {
    project_slug: 'classic',
    q: 'rank:',
    priority: null,
  });
  expect(unset.data.items.map((task) => task.id)).toEqual(
    selectedIds(['rank_classic_unset', 'rank_classic_json_null']),
  );
  expect(view.snapshot()).toEqual(before);
});
it('[ready] literal Unicode search intersects configured category, kind, marker, status, priority and explicit scope', () => {
  const before = view.snapshot();
  const query = '100%_\\ рЕгИсТр';
  expect(
    new Set(
      listTasks(view.readContext, { all_projects: true, q: query }).data.items.map(
        (task) => task.id,
      ),
    ),
  ).toEqual(new Set(selectedIds(['search_title', 'search_description'])));
  expect(
    listTasks(view.readContext, {
      project_slug: 'classic',
      q: query,
      category: 'in_progress',
      kind: 'ordinary',
      status_id: 'in_progress',
      emoji: '🧪',
      priority: null,
    }).data.items.map((task) => task.id),
  ).toEqual([id('search_title')]);
  expect(
    listTasks(view.readContext, {
      project_slug: 'beta-named',
      priority: { model: 'named', level_id: 'not-in-use' },
    }).data.items,
  ).toEqual([]);
  expect(
    listTasks(view.readContext, {
      all_projects: true,
      q: query,
      priority: { model: 'numeric', value: 1.25 },
    }).data.items,
  ).toEqual([]);
  expect(view.snapshot()).toEqual(before);
});
it('[ready] archive and terminal switches preserve custom-category meaning and one recurring parent with earliest pending/debt', () => {
  const before = view.snapshot();
  expect(listTasks(view.readContext, { all_projects: true, q: 'visibility:' }).data.items).toEqual(
    [],
  );
  expect(
    new Set(
      listTasks(view.readContext, {
        all_projects: true,
        q: 'visibility:',
        include_terminal: true,
      }).data.items.map((task) => task.id),
    ),
  ).toEqual(new Set(selectedIds(['terminal_completed', 'terminal_cancelled'])));
  expect(
    new Set(
      listTasks(view.readContext, {
        all_projects: true,
        q: 'visibility:',
        archive: 'only',
      }).data.items.map((task) => task.id),
    ),
  ).toEqual(new Set(selectedIds(['task_archived', 'project_archived'])));
  const recurring = listTasks(view.readContext, {
    project_slug: 'classic',
    q: 'agenda:',
    kind: 'recurring',
  }).data.items;
  expect(recurring).toHaveLength(2);
  expect(recurring.find((task) => task.id === id('recurring_open'))?.display_deadline).toBe(
    new Date(view.asOf - 2).toISOString(),
  );
  expect(recurring.find((task) => task.id === id('recurring_empty'))?.display_deadline).toBeNull();
  expect(view.snapshot()).toEqual(before);
});
it('priorities preserve project-first order and exact classic, named, numeric directions and Eisenhower quadrants', async () => {
  const read = await groupedApi('priorities');
  const before = view.snapshot();
  const result = read({ all_projects: true, q: 'rank:', limit: 200 });
  expect(result.data.groups.map((group) => group.project.slug)).toEqual(view.projectOrder);
  expect(items(result).map((task) => task.id)).toEqual(
    selectedIds([
      'rank_numeric_higher_best',
      'rank_numeric_higher_second',
      'rank_numeric_higher_unset',
      'rank_classic_critical',
      'rank_classic_high',
      'rank_classic_normal',
      'rank_classic_low',
      'rank_classic_unset',
      'rank_classic_json_null',
      'rank_eisen_iu',
      'rank_eisen_in',
      'rank_eisen_nu',
      'rank_eisen_nn',
      'rank_eisen_unset',
      'rank_named_first',
      'rank_named_second',
      'rank_named_unset',
      'rank_numeric_lower_best',
      'rank_numeric_lower_second',
      'rank_numeric_lower_unset',
    ]),
  );
  expect(
    result.data.groups.find((group) => group.project.slug === 'beta-named')?.priority_model,
  ).toMatchObject({ type: 'named', levels: [{ id: 'z_first' }, { id: 'a_second' }] });
  expect(
    result.data.groups.find((group) => group.project.slug === 'classic')?.ordinary_statuses,
  ).toContainEqual(
    expect.objectContaining({
      id: 'in_progress',
      label: 'Нестандартная работа',
      category: 'in_progress',
    }),
  );
  expect(result.meta.as_of).toBe(new Date(view.asOf).toISOString());
  expect(view.snapshot()).toEqual(before);
});
it.each([Date.UTC(2026, 2, 28, 22, 59, 59, 900), Date.UTC(2026, 9, 24, 21, 59, 59, 900)])(
  'agenda uses local calendar boundaries across DST at %i and gives project grouping precedence over bucket',
  async (asOf) => {
    await view.fixture.close();
    view = await createReadViewsFixture({ asOf });
    const read = await groupedApi('agenda');
    const before = view.snapshot();
    const result = read({ all_projects: true, q: 'agenda:', limit: 200 });
    expect(result.data.groups.map((group) => group.project.slug)).toEqual([
      'max-numeric',
      'classic',
    ]);
    expect(items(result)[0]?.id).toBe(id('higher_project_later'));
    const classified = buckets(result);
    for (const [meaning, bucket] of [
      ['overdue', 'overdue'],
      ['exact', 'today'],
      ['today_last', 'today'],
      ['clock_crossing', 'today'],
      ['next_start', 'next_7_days'],
      ['next_last', 'next_7_days'],
      ['later', 'later'],
      ['undated', 'no_deadline'],
      ['recurring_open', 'overdue'],
      ['recurring_empty', 'no_deadline'],
    ] as const)
      expect(classified[id(meaning)], meaning).toBe(bucket);
    expect(view.next7End - view.todayEnd).not.toBe(7 * 86400000);
    expect(new Set(items(result).map((task) => task.id)).size).toBe(11);
    const terminal = buckets(
      read({ project_slug: 'classic', q: 'visibility:', include_terminal: true }),
    );
    expect(terminal[id('terminal_completed')]).toBe('today');
    expect(terminal[id('terminal_cancelled')]).toBe('no_deadline');
    expect(view.snapshot()).toEqual(before);
  },
);
it('agenda continuation pins as_of across deadline and local midnight; a fresh first page reclassifies without writes', async () => {
  const read = await groupedApi('agenda');
  const before = view.snapshot();
  const original = read({ project_slug: 'classic', q: 'agenda:', limit: 200 });
  let page = read({ project_slug: 'classic', q: 'agenda:', limit: 1 });
  const received = [...items(page)];
  let pages = 1;
  while (page.data.next_cursor !== null) {
    if (pages++ > 20) throw new Error('Pagination did not terminate');
    view.clock.set(view.todayEnd);
    page = read({ project_slug: 'classic', q: 'agenda:', limit: 1, cursor: page.data.next_cursor });
    expect(page.meta.as_of).toBe(original.meta.as_of);
    expect(page.meta.now).not.toBe(original.meta.now);
    received.push(...items(page));
  }
  expect(received).toEqual(items(original));
  expect(new Set(received.map((task) => task.id)).size).toBe(received.length);
  const fresh = read({ project_slug: 'classic', q: 'agenda:', limit: 200 });
  expect(fresh.meta.as_of).not.toBe(original.meta.as_of);
  expect(buckets(fresh)[id('clock_crossing')]).toBe('overdue');
  expect(buckets(fresh)[id('next_start')]).toBe('today');
  expect(view.snapshot()).toEqual(before);
});
it('agenda after a midnight gap ends today at the next local midnight, not the skipped-day start hour', async () => {
  await view.fixture.close();
  view = await createReadViewsFixture({
    asOf: Date.UTC(2026, 8, 6, 4, 30),
    timezone: 'America/Santiago',
  });
  // 2026-09-06 midnight is skipped; Sep 7 midnight is 03:00Z, not 04:00Z.
  updateTask(
    view.fixture.human,
    'classic',
    id('later'),
    ordinaryInput(
      view.fixture,
      {
        deadline: '2026-09-07T03:00:00.000Z',
      },
      { projectSlug: 'classic', revision: 1 },
    ),
  );
  const before = view.snapshot();
  const read = await groupedApi('agenda');
  const result = read({ project_slug: 'classic', q: 'agenda: later' });
  expect(items(result)).toHaveLength(1);
  expect(items(result)[0]?.agenda_bucket).toBe('next_7_days');
  expect(view.snapshot()).toEqual(before);
});
it.each(['agenda', 'priorities'] as const)(
  '%s cursors reject changed scope/filter/data while malformed clocks and tokens fail validation',
  async (kind) => {
    const read = await groupedApi(kind);
    const first = read({ all_projects: true, q: 'agenda:', limit: 1 });
    if (!first.data.next_cursor) throw new Error('Expected a continuation token');
    const cursor = first.data.next_cursor;
    const before = view.snapshot();
    const otherFamily = await groupedApi(kind === 'agenda' ? 'priorities' : 'agenda');
    expect(() => otherFamily({ all_projects: true, q: 'agenda:', limit: 1, cursor })).toThrow(
      expect.objectContaining({ code: 'CURSOR_STALE' }),
    );
    expect(() =>
      listTasks(view.readContext, { all_projects: true, q: 'agenda:', limit: 1, cursor }),
    ).toThrow(expect.objectContaining({ code: 'CURSOR_STALE' }));
    for (const change of [{ q: 'rank:' }, { project_slug: 'classic' }]) {
      const input =
        'project_slug' in change
          ? { project_slug: 'classic', q: 'agenda:', limit: 1, cursor }
          : { all_projects: true, q: 'rank:', limit: 1, cursor };
      expect(() => read(input)).toThrow(expect.objectContaining({ code: 'CURSOR_STALE' }));
    }
    for (const input of [
      { all_projects: true, now: 0 },
      { all_projects: true, as_of: '2026-01-01T00:00:00.000Z' },
      { all_projects: true, cursor: 'tampered' },
    ])
      expect(() => read(input)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(view.snapshot()).toEqual(before);
    updateTask(
      view.fixture.human,
      'classic',
      id('overdue'),
      ordinaryInput(
        view.fixture,
        { title: 'Changed data' },
        { projectSlug: 'classic', revision: 1 },
      ),
    );
    const written = view.snapshot();
    expect(() => read({ all_projects: true, q: 'agenda:', limit: 1, cursor })).toThrow(
      expect.objectContaining({ code: 'CURSOR_STALE' }),
    );
    expect(view.snapshot()).toEqual(written);
  },
);
const counters = z.object({
  tasks: z.object({
    total: z.number(),
    by_kind: z.record(z.string(), z.number()),
    by_category: z.record(z.string(), z.number()),
  }),
  ordinary: z.object({ unfinished: z.number(), overdue: z.number(), completed: z.number() }),
  occurrences: z.object({
    pending: z.number(),
    debt: z.number(),
    missed: z.number(),
    completed: z.number(),
    completed_late: z.number(),
    cancelled: z.number(),
    total: z.number(),
  }),
});
async function statistics() {
  const path = '../../src/core/queries/statistics.js';
  const loaded: unknown = await import(path);
  const read = z
    .object({ getStatistics: z.custom<ReadCall>((value) => typeof value === 'function') })
    .parse(loaded).getStatistics;
  const schema = z.extend(successEnvelopeSchema, {
    data: z.extend(counters, {
      groups: z.array(
        z.extend(counters, { project: projectProjection, priority_model: priorityModelSchema }),
      ),
    }),
  });
  return (input: Record<string, JsonValue>) => schema.parse(read(view.readContext, input));
}
it('statistics keep four parent tasks separate from six occurrence outcomes and retain one reference instant', async () => {
  const read = await statistics();
  const before = view.snapshot();
  const result = read({ project_slug: 'classic', q: 'stats:', include_terminal: true });
  expect(result.data).toMatchObject({
    tasks: { total: 4, by_kind: { ordinary: 3, recurring: 1 } },
    ordinary: { unfinished: 2, overdue: 1, completed: 1 },
    occurrences: {
      pending: 1,
      debt: 1,
      missed: 1,
      completed: 1,
      completed_late: 1,
      cancelled: 1,
      total: 6,
    },
  });
  expect(result.data.groups).toHaveLength(1);
  expect(result.meta.as_of).toBe(new Date(view.asOf).toISOString());
  expect(read({ project_slug: 'classic', q: 'stats:' }).data.occurrences).toMatchObject({
    cancelled: 0,
    completed: 1,
    completed_late: 1,
    total: 5,
  });
  expect(view.snapshot()).toEqual(before);
});
it('statistics use each metric timestamp with half-open bounds, unbounded nulls, empty equality and reversed validation', async () => {
  const read = await statistics();
  const before = view.snapshot();
  const from = new Date(view.completedAt).toISOString();
  const to = new Date(view.completedAt + 1).toISOString();
  const bounded = read({ project_slug: 'classic', q: 'stats:', include_terminal: true, from, to });
  expect(bounded.data).toMatchObject({
    tasks: { total: 0 },
    ordinary: { unfinished: 0, overdue: 0, completed: 1 },
    occurrences: {
      pending: 0,
      debt: 0,
      missed: 0,
      completed: 1,
      completed_late: 1,
      cancelled: 0,
      total: 2,
    },
  });
  const atEnd = read({ project_slug: 'classic', q: 'stats:', include_terminal: true, to: from });
  expect(atEnd.data.ordinary.completed).toBe(0);
  expect(atEnd.data.occurrences.completed).toBe(0);
  expect(atEnd.data.occurrences.completed_late).toBe(0);
  const empty = read({
    project_slug: 'classic',
    q: 'stats:',
    include_terminal: true,
    from,
    to: from,
  });
  expect(empty.data).toMatchObject({
    tasks: { total: 0 },
    ordinary: { unfinished: 0, overdue: 0, completed: 0 },
    occurrences: { total: 0 },
  });
  expect(() => read({ project_slug: 'classic', from: to, to: from })).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(
    read({ project_slug: 'classic', q: 'stats:', include_terminal: true }).data.tasks.total,
  ).toBe(4);
  expect(view.snapshot()).toEqual(before);
});
