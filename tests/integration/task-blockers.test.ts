import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addDependency } from '../../src/core/tasks/dependencies.js';
import { listTasks } from '../../src/core/queries/tasks.js';
import { boardWork, boardColumn, boardSnapshot } from '../fixtures/board.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture?.close();
});
it('reports real blockers in board and server search using current cross-project completion semantics', async () => {
  const { api, task, betaTask, third } = await boardWork(fixture);
  addDependency(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(
      fixture,
      { prerequisite_task_id: betaTask.id, prerequisite_project_slug: 'beta' },
      { revision: 1 },
    ),
  );
  const blocked = () => boardColumn(fixture).data.items.find((row) => row.id === task.id);
  expect(blocked()).toMatchObject({ blocked: true });
  expect(boardColumn(fixture).data.items.find((row) => row.id === third.id)).toMatchObject({
    blocked: false,
  });
  expect(
    listTasks(fixture.human, { project_slug: 'alpha', q: 'Начальная' }).data.items,
  ).toMatchObject([{ id: task.id, blocked: true }]);
  let revision = 1;
  for (const status of ['planning', 'ready', 'in_progress', 'sanity_check', 'done']) {
    api.transitionTask(
      fixture.human,
      'beta',
      betaTask.id,
      ordinaryInput(
        fixture,
        {
          to_status_id: status,
          ...(status === 'done'
            ? { confirmation: { asserted: true, user_text: 'Выполнено' } }
            : {}),
        },
        { projectSlug: 'beta', revision },
      ),
    );
    revision++;
  }
  expect(blocked()).toMatchObject({ blocked: false });
  api.archiveTask(
    fixture.human,
    'beta',
    betaTask.id,
    ordinaryInput(fixture, {}, { projectSlug: 'beta', revision }),
  );
  revision++;
  expect(blocked()).toMatchObject({ blocked: false });
  api.restoreTask(
    fixture.human,
    'beta',
    betaTask.id,
    ordinaryInput(fixture, {}, { projectSlug: 'beta', revision }),
  );
  revision++;
  api.transitionTask(
    fixture.human,
    'beta',
    betaTask.id,
    ordinaryInput(fixture, { to_status_id: 'in_progress' }, { projectSlug: 'beta', revision }),
  );
  revision++;
  expect(blocked()).toMatchObject({ blocked: true });
  api.transitionTask(
    fixture.human,
    'beta',
    betaTask.id,
    ordinaryInput(fixture, { to_status_id: 'cancelled' }, { projectSlug: 'beta', revision }),
  );
  expect(blocked()).toMatchObject({ blocked: true });
});
it('batches blocker reads for one and fifty cards in at most ten read queries without writes', async () => {
  const { task, betaTask, create } = await boardWork(fixture);
  const ids = [task.id, ...Array.from({ length: 50 }, (_, index) => create(`Пакет ${index}`).id)];
  for (const id of ids)
    addDependency(
      fixture.human,
      'alpha',
      id,
      ordinaryInput(
        fixture,
        { prerequisite_task_id: betaTask.id, prerequisite_project_slug: 'beta' },
        { revision: 1 },
      ),
    );
  const nativePrepare = fixture.connection.sqlite.prepare.bind(fixture.connection.sqlite);
  function read(limit: number) {
    let count = 0;
    const spy = vi.spyOn(fixture.connection.sqlite, 'prepare').mockImplementation((sql: string) => {
      if (/^\s*(select|with)\b/iu.test(sql)) count++;
      return nativePrepare(sql);
    });
    try {
      return { result: boardColumn(fixture, 'idea', { limit }), count };
    } finally {
      spy.mockRestore();
    }
  }
  const before = boardSnapshot(fixture);
  const one = read(1),
    fifty = read(50);
  expect(one.result.data.items).toMatchObject([{ blocked: true }]);
  expect(fifty.result.data.items.filter((row) => row.blocked === true)).toHaveLength(48);
  expect(fifty.count).toBe(one.count);
  expect(fifty.count).toBeLessThanOrEqual(10);
  expect(boardSnapshot(fixture)).toEqual(before);
});
