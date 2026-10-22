import { afterEach, beforeEach, expect, it } from 'vitest';
import { errorEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { updateTask } from '../../src/core/tasks/commands.js';
import { ordinaryInput } from './ordinary-work.js';
import {
  agendaPageSchema,
  prioritiesPageSchema,
  statisticsSchema,
} from './read-views-responses.js';
import {
  createReadViewsHarness,
  type ReadViewsHarness,
  type ViewInput,
  type ViewScope,
} from './read-views-contract.js';
type Transport = 'cli' | 'http';
type GroupedView = 'agenda' | 'priorities';
type Harness = () => ReadViewsHarness;

/** Every entry file owns its own fresh before/after fixture lifecycle. */
export function installReadViewHarness(): Harness {
  let harness: ReadViewsHarness;
  beforeEach(async () => {
    harness = await createReadViewsHarness();
  });
  afterEach(async () => harness?.close());
  return () => harness;
}
export function validReadView(
  result: Awaited<ReturnType<ReadViewsHarness['request']>>,
  transport: Transport,
) {
  expect(result.status, JSON.stringify(result.envelope)).toBe(transport === 'cli' ? 0 : 200);
  if (transport === 'cli') {
    expect(result.stderr).toBe('');
    expect(result.stdout.endsWith('\n')).toBe(true);
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
  }
  return successEnvelopeSchema.parse(result.envelope);
}
function invalid(
  result: Awaited<ReturnType<ReadViewsHarness['request']>>,
  transport: Transport,
  code = 'VALIDATION_ERROR',
) {
  expect(result.status).toBe(
    transport === 'cli' ? (code === 'CURSOR_STALE' ? 4 : 2) : code === 'CURSOR_STALE' ? 409 : 400,
  );
  expect(errorEnvelopeSchema.parse(result.envelope).error.code).toBe(code);
}
async function groupedPage(
  harness: ReadViewsHarness,
  transport: Transport,
  view: GroupedView,
  query: { scope: ViewScope; input: ViewInput },
) {
  const schema = view === 'agenda' ? agendaPageSchema : prioritiesPageSchema;
  return schema.parse(
    validReadView(await harness.request(transport, view, query.scope, query.input), transport),
  );
}
async function firstCursor(harness: ReadViewsHarness, transport: Transport, view: GroupedView) {
  const first = await groupedPage(harness, transport, view, {
    scope: { project_slug: 'classic' },
    input: { q: 'rank:', limit: 1 },
  });
  const cursor = first.data.next_cursor;
  if (!cursor) throw new Error('Expected a real next-page cursor');
  return cursor;
}

export function registerGroupedViewContracts(transport: Transport, current: Harness) {
  it.each(['agenda', 'priorities'] as const)(
    `${transport} %s retains global model ordering and project scope`,
    async (view) => {
      const harness = current();
      const seed = harness.seed();
      const before = harness.snapshot();
      const page = await groupedPage(harness, transport, view, {
        scope: { all_projects: true },
        input: { q: 'rank:', limit: 200 },
      });
      expect(page.data.groups.map((entry) => entry.project.slug)).toEqual(seed.projectOrder);
      const classic = page.data.groups.find((entry) => entry.project.slug === 'classic');
      expect(classic?.items.map((item) => item.id)).toEqual(
        ['critical', 'high', 'normal', 'low', 'unset', 'json_null'].map(
          (key) => seed.idsByMeaning[`rank_classic_${key}`],
        ),
      );
      const eisen = page.data.groups.find((entry) => entry.project.slug === 'alpha-eisen');
      expect(eisen?.items.map((item) => item.id)).toEqual(
        ['iu', 'in', 'nu', 'nn', 'unset'].map((key) => seed.idsByMeaning[`rank_eisen_${key}`]),
      );
      expect(harness.snapshot()).toEqual(before);
    },
  );
  it.each(['agenda', 'priorities'] as const)(
    `${transport} %s retains named pagination ordering and fixed as_of`,
    async (view) => {
      const harness = current();
      const seed = harness.seed();
      const before = harness.snapshot();
      const first = await groupedPage(harness, transport, view, {
        scope: { project_slug: 'beta-named' },
        input: { q: 'rank:', limit: 1 },
      });
      expect(first.data.groups[0]?.priority_model.type).toBe('named');
      expect(first.data.groups[0]?.items[0]?.id).toBe(seed.idsByMeaning.rank_named_first);
      expect(first.data.next_cursor).not.toBeNull();
      const second = await groupedPage(harness, transport, view, {
        scope: { project_slug: 'beta-named' },
        input: { q: 'rank:', limit: 1, cursor: first.data.next_cursor },
      });
      expect(second.meta.as_of).toBe(first.meta.as_of);
      expect(second.data.groups[0]?.items[0]?.id).toBe(seed.idsByMeaning.rank_named_second);
      expect(harness.snapshot()).toEqual(before);
    },
  );
  it.each(['agenda', 'priorities'] as const)(
    `${transport} %s binds its cursor to the original filter`,
    async (view) => {
      const harness = current();
      harness.seed();
      const before = harness.snapshot();
      const cursor = await firstCursor(harness, transport, view);
      invalid(
        await harness.request(
          transport,
          view,
          { project_slug: 'classic' },
          { q: 'different', limit: 1, cursor },
        ),
        transport,
        'CURSOR_STALE',
      );
      expect(harness.snapshot()).toEqual(before);
    },
  );
  it.each(['agenda', 'priorities'] as const)(
    `${transport} %s binds its cursor to explicit scope`,
    async (view) => {
      const harness = current();
      harness.seed();
      const before = harness.snapshot();
      const cursor = await firstCursor(harness, transport, view);
      invalid(
        await harness.request(
          transport,
          view,
          { all_projects: true },
          { q: 'rank:', limit: 1, cursor },
        ),
        transport,
        'CURSOR_STALE',
      );
      expect(harness.snapshot()).toEqual(before);
    },
  );
  it.each(['agenda', 'priorities'] as const)(
    `${transport} %s cursor rejects a real intervening write`,
    async (view) => {
      const harness = current();
      const seed = harness.seed();
      const cursor = await firstCursor(harness, transport, view);
      const id = seed.idsByMeaning.rank_classic_critical;
      if (!id) throw new Error('Missing seeded task');
      updateTask(
        harness.fixture.human,
        'classic',
        id,
        ordinaryInput(
          harness.fixture,
          { title: 'rank: changed' },
          { projectSlug: 'classic', revision: 1 },
        ),
      );
      const committed = harness.snapshot();
      invalid(
        await harness.request(
          transport,
          view,
          { project_slug: 'classic' },
          { q: 'rank:', limit: 1, cursor },
        ),
        transport,
        'CURSOR_STALE',
      );
      expect(harness.snapshot()).toEqual(committed);
    },
  );
  it.each(['agenda', 'priorities'] as const)(
    `${transport} %s exposes fresh empty results honestly`,
    async (view) => {
      const harness = current();
      harness.seed();
      const before = harness.snapshot();
      const empty = await groupedPage(harness, transport, view, {
        scope: { all_projects: true },
        input: { q: 'This exact title is absent' },
      });
      expect(empty.data).toEqual({ groups: [], next_cursor: null });
      expect(harness.snapshot()).toEqual(before);
    },
  );
  it(`${transport} filters literal Markdown/title and full model priority without ticking recurrence`, async () => {
    const harness = current();
    const seed = harness.seed();
    const before = harness.snapshot();
    const found = await groupedPage(harness, transport, 'priorities', {
      scope: { project_slug: 'classic' },
      input: { q: '100%_\\ РЕГИСТР' },
    });
    expect(found.data.groups.flatMap((group) => group.items.map((item) => item.id)).sort()).toEqual(
      [seed.idsByMeaning.search_title, seed.idsByMeaning.search_description].sort(),
    );
    const quadrant = await groupedPage(harness, transport, 'priorities', {
      scope: { project_slug: 'alpha-eisen' },
      input: { priority: { model: 'eisenhower', important: false, urgent: false } },
    });
    expect(quadrant.data.groups[0]?.items.map((item) => item.id)).toEqual([
      seed.idsByMeaning.rank_eisen_nn,
    ]);
    expect(harness.snapshot()).toEqual(before);
  });
}

export function registerMetricViewContracts(transport: Transport, current: Harness) {
  it(`${transport} stats separates four parent tasks from occurrence outcomes and uses recording timestamps`, async () => {
    const harness = current();
    const seed = harness.seed();
    const before = harness.snapshot();
    const result = statisticsSchema.parse(
      validReadView(
        await harness.request(
          transport,
          'stats',
          { project_slug: 'classic' },
          { q: 'stats:', include_terminal: true },
        ),
        transport,
      ),
    );
    expect(result.data.tasks).toMatchObject({ total: 4, by_kind: { ordinary: 3, recurring: 1 } });
    expect(result.data.ordinary).toEqual({ unfinished: 2, overdue: 1, completed: 1 });
    expect(result.data.occurrences).toEqual({
      pending: 1,
      debt: 1,
      missed: 1,
      completed: 1,
      completed_late: 1,
      cancelled: 1,
      total: 6,
    });
    const bounded = statisticsSchema.parse(
      validReadView(
        await harness.request(
          transport,
          'stats',
          { project_slug: 'classic' },
          {
            q: 'stats:',
            include_terminal: true,
            from: new Date(seed.completedAt).toISOString(),
            to: new Date(seed.completedAt + 1).toISOString(),
          },
        ),
        transport,
      ),
    );
    expect(bounded.data.ordinary.completed).toBe(1);
    expect(bounded.data.occurrences.completed).toBe(1);
    expect(bounded.data.occurrences.completed_late).toBe(1);
    expect(bounded.meta.as_of).toBeDefined();
    expect(harness.snapshot()).toEqual(before);
  });
  it.each(['from', 'to', 'equal'] as const)(
    `${transport} statistics accepts %s bounds and excludes null metric timestamps only with a bound`,
    async (kind) => {
      const harness = current();
      const seed = harness.seed();
      const at = new Date(seed.completedAt).toISOString();
      const input =
        kind === 'equal' ? { from: at, to: at } : kind === 'from' ? { from: at } : { to: at };
      const before = harness.snapshot();
      const result = statisticsSchema.parse(
        validReadView(
          await harness.request(
            transport,
            'stats',
            { project_slug: 'classic' },
            { q: 'stats:', include_terminal: true, ...input },
          ),
          transport,
        ),
      );
      if (kind === 'equal') {
        expect(result.data.tasks.total).toBe(0);
        expect(Object.values(result.data.occurrences).every((count) => count === 0)).toBe(true);
        expect(result.data.ordinary).toEqual({ unfinished: 0, overdue: 0, completed: 0 });
      } else {
        expect(result.data.ordinary.unfinished).toBe(kind === 'from' ? 1 : 0);
        expect(result.data.ordinary.completed).toBe(kind === 'from' ? 1 : 0);
        expect(result.data.occurrences.completed).toBe(kind === 'from' ? 1 : 0);
        expect(result.data.occurrences.completed_late).toBe(kind === 'from' ? 1 : 0);
      }
      expect(harness.snapshot()).toEqual(before);
    },
  );
  it.each(['reversed', 'as_of', 'now'] as const)(
    `${transport} rejects %s statistics input without writes`,
    async (kind) => {
      const harness = current();
      const seed = harness.seed();
      const before = harness.snapshot();
      const input =
        kind === 'reversed'
          ? {
              from: new Date(seed.completedAt + 1).toISOString(),
              to: new Date(seed.completedAt).toISOString(),
            }
          : { [kind]: new Date(seed.asOf).toISOString() };
      invalid(await harness.request(transport, 'stats', { all_projects: true }, input), transport);
      expect(harness.snapshot()).toEqual(before);
    },
  );
}
