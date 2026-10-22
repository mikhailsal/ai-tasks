import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod/mini';
import { listTasks } from '../../src/core/queries/tasks.js';
import { createReadViewsFixture, type ReadViewsFixture } from '../fixtures/read-views.js';
import { insertStorageRow, taskRow } from '../fixtures/storage-seed.js';
import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../src/schema/values.js';
let view: ReadViewsFixture;
beforeEach(async () => {
  view = await createReadViewsFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await view?.fixture.close();
});
type Captured = {
  sql: string;
  parameters: unknown[];
};
/** Record actual prepared SQL/bindings while every statement still executes against real SQLite. */
function captureQueries(run: () => unknown) {
  const sqlite = view.fixture.connection.sqlite;
  const nativePrepare = sqlite.prepare.bind(sqlite);
  const queries: Captured[] = [];
  const prepare = vi.spyOn(sqlite, 'prepare').mockImplementation((sql: string) => {
    const statement = nativePrepare(sql);
    const nativeAll = statement.all.bind(statement);
    const nativeGet = statement.get.bind(statement);
    vi.spyOn(statement, 'all').mockImplementation((...parameters: unknown[]) => {
      queries.push({ sql, parameters });
      return nativeAll(...parameters);
    });
    vi.spyOn(statement, 'get').mockImplementation((...parameters: unknown[]) => {
      queries.push({ sql, parameters });
      return nativeGet(...parameters);
    });
    return statement;
  });
  try {
    return { result: run(), queries };
  } finally {
    prepare.mockRestore();
  }
}
function plans(queries: Captured[]) {
  return queries
    .filter((query) => /^\s*(?:select|with)\b/iu.test(query.sql))
    .flatMap((query) =>
      z
        .array(z.object({ detail: z.string() }))
        .parse(
          view.fixture.connection.sqlite
            .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
            .all(...query.parameters),
        )
        .map((row) => row.detail),
    );
}
function addVolume() {
  view.fixture.connection.sqlite.transaction(() => {
    for (let index = 0; index < 80; index++)
      insertStorageRow(
        view.fixture.connection.sqlite,
        'tasks',
        taskRow({
          id: randomUUID(),
          project_slug: 'classic',
          title: `volume: ${index}`,
          deadline: view.asOf + index,
          created_at: view.asOf,
          updated_at: view.asOf,
        }),
      );
  })();
}
it('[ready] real project-scoped task list and earliest open occurrence use authored indexes', () => {
  const before = view.snapshot();
  const captured = captureQueries(() =>
    listTasks(view.readContext, { project_slug: 'classic', kind: 'recurring', limit: 50 }),
  );
  const detail = plans(captured.queries).join('\n');
  expect(detail).toContain('tasks_project_list');
  expect(detail).toContain('occurrences_task_state_deadline_idx');
  expect(detail).not.toMatch(/SCAN occurrences(?:\s|$)/u);
  expect(view.snapshot()).toEqual(before);
});
it('[ready] a project marker search explains the actual indexed emoji lookup and remains pure', () => {
  const before = view.snapshot();
  const captured = captureQueries(() =>
    listTasks(view.readContext, { project_slug: 'classic', emoji: '🧪' }),
  );
  expect(plans(captured.queries).join('\n')).toContain('tasks_project_emoji');
  expect(view.snapshot()).toEqual(before);
});
it('[ready] task parent pagination makes a constant number of SQL calls for one versus fifty rows', () => {
  addVolume();
  const before = view.snapshot();
  const one = captureQueries(() =>
    listTasks(view.readContext, { project_slug: 'classic', limit: 1 }),
  );
  const fifty = captureQueries(() =>
    listTasks(view.readContext, { project_slug: 'classic', limit: 50 }),
  );
  expect(one.queries.length).toBeGreaterThan(0);
  expect(fifty.queries.length).toBe(one.queries.length);
  expect(fifty.queries.length).toBeLessThanOrEqual(8);
  const page = z
    .object({ data: z.object({ items: z.array(z.object({ id: z.uuid() })) }) })
    .parse(fifty.result);
  expect(page.data.items).toHaveLength(50);
  expect(new Set(page.data.items.map((task) => task.id)).size).toBe(50);
  expect(view.snapshot()).toEqual(before);
});
type ReadCall = (
  context: ReadViewsFixture['readContext'],
  input: Record<string, JsonValue>,
) => unknown;
async function futureRead(kind: 'agenda' | 'priorities') {
  const path =
    kind === 'agenda' ? '../../src/core/queries/agenda.js' : '../../src/core/queries/priorities.js';
  const loaded: unknown = await import(path);
  const name = kind === 'agenda' ? 'listAgenda' : 'listPriorities';
  return z
    .custom<ReadCall>((value) => typeof value === 'function')
    .parse(z.record(z.string(), z.unknown()).parse(loaded)[name]);
}
it.each(['agenda', 'priorities'] as const)(
  '%s SQL count stays constant as the parent page grows and retains indexed recurring lookup',
  async (kind) => {
    addVolume();
    const read = await futureRead(kind);
    const before = view.snapshot();
    const one = captureQueries(() => read(view.readContext, { project_slug: 'classic', limit: 1 }));
    const fifty = captureQueries(() =>
      read(view.readContext, { project_slug: 'classic', limit: 50 }),
    );
    expect(fifty.queries.length).toBe(one.queries.length);
    expect(fifty.queries.length).toBeLessThanOrEqual(10);
    expect(plans(fifty.queries).join('\n')).toContain('occurrences_task_state_deadline_idx');
    const parsed = z
      .object({
        data: z.object({
          groups: z.array(z.object({ items: z.array(z.object({ id: z.uuid() })) })),
        }),
      })
      .parse(fifty.result);
    const ids = parsed.data.groups.flatMap((group) => group.items.map((task) => task.id));
    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(ids.length);
    expect(view.snapshot()).toEqual(before);
  },
);
