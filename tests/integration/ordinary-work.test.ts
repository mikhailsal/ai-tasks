import { randomUUID } from 'node:crypto';
import { z } from 'zod/mini';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { JsonValue } from '../../src/schema/values.js';
import {
  createOrdinaryFixture,
  invokeOrdinaryCli,
  ordinaryInput,
  ordinarySnapshot,
  customProjectConfig,
  ordinaryPriorityModels,
  ordinaryApi,
  ordinaryProjectApi,
  initialWork,
  durableCounts,
  mutationCases,
  preparedMutation,
  taskAt,
  taskShape,
  projectShape,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
function rejects(action: () => unknown, code: string) {
  expect(action).toThrowError(expect.objectContaining({ code }));
}
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
});
afterEach(() => fixture?.close());
it.each(['audit_records', 'operation_receipts'] as const)(
  'project creation rolls back initial config/reservations on %s failure and guards the complete replay identity',
  async (table) => {
    const api = await ordinaryProjectApi();
    const payload = { slug: 'alpha', name: 'Альфа', emoji: '🔵', config: customProjectConfig() };
    const input = ordinaryInput(fixture, payload);
    const before = ordinarySnapshot(fixture);
    rejects(
      () => api.createProject(fixture.human, 'alpha', { ...input, database_epoch: randomUUID() }),
      'DATABASE_EPOCH_CONFLICT',
    );
    fixture.connection.sqlite.exec(`CREATE TRIGGER reject_project_creation BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'injected project persistence failure'); END`);
    expect(() => api.createProject(fixture.human, 'alpha', input)).toThrow();
    expect(ordinarySnapshot(fixture)).toEqual(before);
    fixture.connection.sqlite.exec('DROP TRIGGER reject_project_creation');
    const result = api.createProject(fixture.human, 'alpha', input);
    const committed = ordinarySnapshot(fixture);
    expect(api.createProject(fixture.human, 'alpha', input)).toEqual(result);
    rejects(
      () =>
        api.createProject(fixture.human, 'alpha', {
          ...input,
          payload: { ...payload, name: 'Изменённое имя' },
        }),
      'IDEMPOTENCY_CONFLICT',
    );
    rejects(
      () => api.createProject(fixture.agent('alpha'), 'alpha', input),
      'IDEMPOTENCY_CONFLICT',
    );
    rejects(() => api.createProject(fixture.human, 'beta', input), 'IDEMPOTENCY_CONFLICT');
    expect(ordinarySnapshot(fixture)).toEqual(committed);
    fixture.connection.sqlite
      .prepare('UPDATE application_state SET database_epoch = ? WHERE id = 1')
      .run(randomUUID());
    const replaced = ordinarySnapshot(fixture);
    rejects(() => api.createProject(fixture.human, 'alpha', input), 'DATABASE_EPOCH_CONFLICT');
    expect(ordinarySnapshot(fixture)).toEqual(replaced);
  },
);
it('compiled CLI creates a real project successfully [US1 behavioral red]', () => {
  const request = ordinaryInput(fixture, { slug: 'alpha', name: 'Альфа', emoji: '🔵' });
  const result = invokeOrdinaryCli(
    fixture,
    ['project', 'create', '--project', 'alpha', '--json', '--input', '-'],
    {
      operation_id: request.operation_id,
      database_epoch: request.database_epoch,
      slug: 'alpha',
      name: 'Альфа',
      emoji: '🔵',
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, `Expected project creation; stderr=${result.stderr}`).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: true,
    data: { slug: 'alpha', name: 'Альфа', revision: 1 },
  });
  expect(fixture.connection.sqlite.prepare('SELECT slug FROM projects').all()).toEqual([
    { slug: 'alpha' },
  ]);
});
it('preserves immutable slug scope and rejects foreign children before project archival', async () => {
  const { api, task, betaTask } = await initialWork(fixture);
  const before = ordinarySnapshot(fixture);
  rejects(
    () =>
      api.updateProject(
        fixture.human,
        'alpha',
        ordinaryInput(fixture, { slug: 'renamed' }, { revision: 1 }),
      ),
    'VALIDATION_ERROR',
  );
  rejects(
    () =>
      api.createTask(
        fixture.agent('beta'),
        'alpha',
        ordinaryInput(fixture, { kind: 'ordinary', title: 'Неверный актор' }),
      ),
    'VALIDATION_ERROR',
  );
  const input = ordinaryInput(
    fixture,
    {
      affected_tasks: [
        { task_id: task.id, expected_revision: 1 },
        { task_id: betaTask.id, expected_revision: 1 },
      ],
    },
    { revision: 1 },
  );
  rejects(() => api.archiveProject(fixture.human, 'alpha', input), 'PROJECT_MISMATCH');
  expect(ordinarySnapshot(fixture)).toEqual(before);
});
it.each(mutationCases)(
  '%s commits state/audit/receipt, replays exactly before stale guards, and rejects changed proposals',
  async (kind) => {
    const { input, invoke } = await preparedMutation(fixture, kind);
    const before = ordinarySnapshot(fixture);
    const counts = durableCounts(fixture);
    const result = invoke(fixture.human, input);
    expect(result).toMatchObject({
      ok: true,
      meta: { operation_id: input.operation_id, database_epoch: fixture.epoch },
    });
    expect(result.meta.audit_ids.length).toBeGreaterThan(0);
    expect(durableCounts(fixture)).toEqual({
      audit: Number(counts.audit) + result.meta.audit_ids.length,
      receipt: Number(counts.receipt) + 1,
    });
    expect(ordinarySnapshot(fixture)).not.toEqual(before);
    const committed = ordinarySnapshot(fixture);
    fixture.clock.advanceBy(60000);
    expect(invoke(fixture.human, input)).toEqual(result);
    expect(ordinarySnapshot(fixture)).toEqual(committed);
    for (const changed of [
      { ...input, expected_revision: (input.expected_revision ?? 1) + 1 },
      { ...input, payload: { changed_proposal: true } },
    ])
      expect(() => invoke(fixture.human, changed)).toThrowError(
        expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
      );
    expect(() => invoke(fixture.agent('alpha'), input)).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
    );
    expect(() => invoke(fixture.human, input, 'beta')).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
    );
    expect(ordinarySnapshot(fixture)).toEqual(committed);
  },
);
it.each(mutationCases)(
  '%s rejects stale epoch/config/entity tokens and rolls back persistence failures atomically',
  async (kind) => {
    const { input, invoke } = await preparedMutation(fixture, kind);
    const before = ordinarySnapshot(fixture);
    expect(() => invoke(fixture.human, { ...input, database_epoch: randomUUID() })).toThrowError(
      expect.objectContaining({ code: 'DATABASE_EPOCH_CONFLICT' }),
    );
    expect(() => invoke(fixture.human, { ...input, expected_config_revision: 99 })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_CONFLICT' }),
    );
    if (kind !== 'task-create')
      expect(() => invoke(fixture.human, { ...input, expected_revision: 99 })).toThrowError(
        expect.objectContaining({ code: 'REVISION_CONFLICT' }),
      );
    expect(ordinarySnapshot(fixture)).toEqual(before);
    fixture.connection.sqlite
      .exec(`CREATE TRIGGER reject_ordinary_receipt BEFORE INSERT ON operation_receipts
    BEGIN SELECT RAISE(ABORT, 'test receipt failure'); END`);
    expect(() => invoke(fixture.human, input)).toThrow();
    expect(ordinarySnapshot(fixture)).toEqual(before);
    fixture.connection.sqlite.exec('DROP TRIGGER reject_ordinary_receipt');
    expect(invoke(fixture.human, input)).toMatchObject({ ok: true });
  },
);
it.each(mutationCases)(
  '%s rejects invalid command data without changing state or success history',
  async (kind) => {
    const { input, invoke } = await preparedMutation(fixture, kind);
    const invalid: Record<(typeof mutationCases)[number], JsonValue> = {
      'project-update': { priority: null },
      'project-archive': { affected_tasks: [] },
      'project-restore': { affected_tasks: [] },
      'task-create': { kind: 'ordinary', title: ' ' },
      'task-update': { title: '' },
      'task-transition': { to_status_id: 'done' },
      'task-archive': { unexpected: true },
      'task-restore': {
        confirmation: { asserted: true, user_text: 'Unexpected ordinary restore consent' },
      },
    };
    const before = ordinarySnapshot(fixture);
    expect(() => invoke(fixture.human, { ...input, payload: invalid[kind] })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(ordinarySnapshot(fixture)).toEqual(before);
  },
);
it.each(['task-update', 'task-transition', 'task-archive', 'task-restore'] as const)(
  '%s rejects an existing task in another project',
  async (kind) => {
    const { input, invoke } = await preparedMutation(fixture, kind);
    const before = ordinarySnapshot(fixture);
    rejects(
      () => invoke(fixture.human, { ...input, operation_id: randomUUID() }, 'beta'),
      'PROJECT_MISMATCH',
    );
    expect(ordinarySnapshot(fixture)).toEqual(before);
  },
);
it.each(['human', 'agent'] as const)(
  'project creation uses explicit new scope and %s attribution with atomic initial config',
  async (actor) => {
    const api = await ordinaryProjectApi();
    const context = actor === 'human' ? fixture.human : fixture.agent('alpha');
    const input = ordinaryInput(fixture, { slug: 'alpha', name: '  Альфа  ', emoji: '🔵' });
    const result = api.createProject(context, 'alpha', input);
    expect(result.data).toMatchObject({
      slug: 'alpha',
      name: 'Альфа',
      priority: 0,
      revision: 1,
      config_revision: 1,
    });
    expect(
      fixture.connection.sqlite.prepare('SELECT actor, project_slug FROM audit_records').all(),
    ).toEqual(
      result.meta.audit_ids.map(() => ({
        actor: actor === 'human' ? 'human-web' : 'ai-cli:alpha',
        project_slug: 'alpha',
      })),
    );
    const config = fixture.connection.sqlite
      .prepare('SELECT priority_model, ordinary_workflow, recurring_workflow FROM project_configs')
      .get();
    expect(config).toMatchObject({ priority_model: '{"type":"classic"}' });
    const after = ordinarySnapshot(fixture);
    expect(api.createProject(context, 'alpha', input)).toEqual(result);
    expect(ordinarySnapshot(fixture)).toEqual(after);
    rejects(
      () => api.createProject(context, 'alpha', { ...input, operation_id: randomUUID() }),
      'VALIDATION_ERROR',
    );
    rejects(
      () => api.createProject(context, 'beta', { ...input, operation_id: randomUUID() }),
      'VALIDATION_ERROR',
    );
    expect(ordinarySnapshot(fixture)).toEqual(after);
  },
);
it.each(ordinaryPriorityModels)(
  'creates supplied %j configuration and uses its sole configured initial status',
  async (model) => {
    const api = await ordinaryApi();
    const config = customProjectConfig(model);
    api.createProject(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { slug: 'alpha', name: 'Альфа', emoji: '🔵', config }),
    );
    const stored = z
      .object({ semantic_snapshot: z.string() })
      .parse(
        fixture.connection.sqlite.prepare('SELECT semantic_snapshot FROM project_configs').get(),
      );
    expect(JSON.parse(stored.semantic_snapshot)).toEqual(config);
    const result = api.createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { kind: 'ordinary', title: 'Настроенная задача' }),
    );
    expect(result.data).toMatchObject({ status_id: 'queued', category: 'not_started' });
    const before = ordinarySnapshot(fixture);
    rejects(
      () =>
        api.createTask(
          fixture.human,
          'alpha',
          ordinaryInput(fixture, { kind: 'ordinary', title: 'Неверный старт', status_id: 'doing' }),
        ),
      'VALIDATION_ERROR',
    );
    expect(ordinarySnapshot(fixture)).toEqual(before);
  },
);
it.each([
  { priority_model: { type: 'numeric', min: 5, max: 1, direction: 'higher' } },
  { ordinary_workflow: { initial_status_id: 'missing', statuses: [], transitions: [] } },
  {
    recurring_workflow: {
      initial_status_id: 'draft',
      restore_status_id: 'missing',
      statuses: [],
      transitions: [],
    },
  },
])(
  'rolls back project/reservations/config/audit/receipt for invalid supplied configuration %j',
  async (invalid) => {
    const api = await ordinaryProjectApi();
    const before = ordinarySnapshot(fixture);
    rejects(
      () =>
        api.createProject(
          fixture.human,
          'alpha',
          ordinaryInput(fixture, {
            slug: 'alpha',
            name: 'Альфа',
            emoji: '🔵',
            config: { ...customProjectConfig(), ...invalid },
          }),
        ),
      'VALIDATION_ERROR',
    );
    expect(ordinarySnapshot(fixture)).toEqual(before);
  },
);
it('preserves raw Markdown, nullable priority/deadline, omission semantics and exact UTC timestamps', async () => {
  const { api, task } = await initialWork(fixture);
  const description = '# Исходник\n\n**Текст** 🔵\n\n- first\n- second\n';
  let result = api.updateTask(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(
      fixture,
      {
        description,
        priority: { model: 'classic', level: 'high' },
        deadline: '2026-10-21T13:14:15.123+03:00',
      },
      { revision: 1 },
    ),
  );
  expect(result.data).toMatchObject({
    description,
    priority: { model: 'classic', level: 'high' },
    deadline: '2026-10-21T10:14:15.123Z',
    revision: 2,
  });
  result = api.updateTask(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(fixture, { title: 'Только заголовок' }, { revision: 2 }),
  );
  expect(result.data).toMatchObject({ description, deadline: '2026-10-21T10:14:15.123Z' });
  result = api.updateTask(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(
      fixture,
      { description: 'Полная замена', deadline: null, priority: null },
      { revision: 3 },
    ),
  );
  expect(result.data).toMatchObject({
    description: 'Полная замена',
    deadline: null,
    priority: null,
    revision: 4,
  });
  expect(api.getTask(fixture.human, 'alpha', task.id).data).toMatchObject({
    description: 'Полная замена',
    deadline: null,
    priority: null,
  });
});
it.each(['2026-10-21', '2026-10-21T10:00:00', '2026-10-21T10:00:00.1234Z'])(
  'rejects imprecise or unsupported deadline %s atomically',
  async (deadline) => {
    const { api, task } = await initialWork(fixture);
    const before = ordinarySnapshot(fixture);
    rejects(
      () =>
        api.updateTask(
          fixture.human,
          'alpha',
          task.id,
          ordinaryInput(fixture, { deadline }, { revision: 1 }),
        ),
      'VALIDATION_ERROR',
    );
    expect(ordinarySnapshot(fixture)).toEqual(before);
  },
);
it.each([
  ['idea', 'planning'],
  ['planning', 'ready'],
  ['ready', 'in_progress'],
  ['in_progress', 'sanity_check'],
  ['sanity_check', 'done'],
  ['planning', 'idea'],
  ['ready', 'planning'],
  ['in_progress', 'ready'],
  ['sanity_check', 'in_progress'],
  ['done', 'sanity_check'],
  ['done', 'in_progress'],
  ['idea', 'cancelled'],
  ['planning', 'cancelled'],
  ['ready', 'cancelled'],
  ['in_progress', 'cancelled'],
  ['sanity_check', 'cancelled'],
])('allows configured default edge %s → %s with one atomic result', async (from, to) => {
  const { api, task } = await taskAt(fixture, from);
  const result = api.transitionTask(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(
      fixture,
      to === 'done'
        ? { to_status_id: to, confirmation: { asserted: true, user_text: 'Согласовано' } }
        : { to_status_id: to },
      { revision: task.revision },
    ),
  );
  expect(result.data).toMatchObject({ status_id: to, revision: task.revision + 1 });
});
it('requires actual confirmation text, preserves it exactly in audit, and supports cancelled → idea', async () => {
  const { api, task } = await taskAt(fixture, 'sanity_check');
  const before = ordinarySnapshot(fixture);
  for (const confirmation of [
    undefined,
    { asserted: true, user_text: '' },
    { asserted: false, user_text: 'Нет' },
  ]) {
    const payload =
      confirmation === undefined
        ? { to_status_id: 'done' }
        : { to_status_id: 'done', confirmation };
    rejects(
      () =>
        api.transitionTask(
          fixture.human,
          'alpha',
          task.id,
          ordinaryInput(fixture, payload, { revision: task.revision }),
        ),
      'CONFIRMATION_REQUIRED',
    );
    expect(ordinarySnapshot(fixture)).toEqual(before);
  }
  const text = '  Пользователь подтвердил именно этот переход 🔵  ';
  const done = api.transitionTask(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(
      fixture,
      { to_status_id: 'done', confirmation: { asserted: true, user_text: text } },
      { revision: task.revision },
    ),
  );
  expect(
    JSON.parse(
      String(
        fixture.connection.sqlite
          .prepare('SELECT confirmation FROM audit_records WHERE id = ?')
          .pluck()
          .get(done.meta.audit_ids[0]),
      ),
    ),
  ).toEqual({ asserted: true, user_text: text });
  let current = taskShape.parse(
    api.transitionTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, { to_status_id: 'in_progress' }, { revision: task.revision + 1 }),
    ).data,
  );
  current = taskShape.parse(
    api.transitionTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, { to_status_id: 'cancelled' }, { revision: current.revision }),
    ).data,
  );
  expect(
    api.transitionTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, { to_status_id: 'idea' }, { revision: current.revision }),
    ).data,
  ).toMatchObject({ status_id: 'idea', category: 'not_started' });
});
it.each(['human-first', 'agent-first'] as const)(
  'retains the winning whole description under %s stale and disjoint-field proposals',
  async (order) => {
    const { api, task } = await initialWork(fixture);
    const winner = order === 'human-first' ? fixture.human : fixture.agent('alpha');
    const loser = order === 'human-first' ? fixture.agent('alpha') : fixture.human;
    api.updateTask(
      winner,
      'alpha',
      task.id,
      ordinaryInput(fixture, { description: 'Выигравший полный текст' }, { revision: 1 }),
    );
    const before = ordinarySnapshot(fixture);
    for (const payload of [
      { description: 'Устаревший текст' },
      { title: 'Независимое устаревшее поле' },
    ]) {
      rejects(
        () =>
          api.updateTask(loser, 'alpha', task.id, ordinaryInput(fixture, payload, { revision: 1 })),
        'REVISION_CONFLICT',
      );
      expect(ordinarySnapshot(fixture)).toEqual(before);
    }
    expect(api.getTask(fixture.human, 'alpha', task.id).data).toMatchObject({
      description: 'Выигравший полный текст',
      title: task.title,
    });
  },
);
it('archives/restores ordinary tasks without changing workflow status and rejects archived editing', async () => {
  const { api, task } = await taskAt(fixture, 'in_progress');
  const archived = api.archiveTask(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(fixture, {}, { revision: task.revision }),
  );
  expect(archived.data).toMatchObject({ status_id: 'in_progress', category: 'in_progress' });
  const before = ordinarySnapshot(fixture);
  rejects(
    () =>
      api.updateTask(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(fixture, { description: 'Нельзя' }, { revision: task.revision + 1 }),
      ),
    'VALIDATION_ERROR',
  );
  rejects(
    () =>
      api.transitionTask(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(fixture, { to_status_id: 'ready' }, { revision: task.revision + 1 }),
      ),
    'VALIDATION_ERROR',
  );
  expect(ordinarySnapshot(fixture)).toEqual(before);
  expect(api.getTask(fixture.human, 'alpha', task.id).data).toMatchObject({
    status_id: 'in_progress',
  });
  expect(
    api.restoreTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, {}, { revision: task.revision + 1 }),
    ).data,
  ).toMatchObject({ status_id: 'in_progress', archived_at: null });
});
it('project archive/restore requires every child revision while preserving ordinary child rows and reservations', async () => {
  const { api, task } = await initialWork(fixture);
  const children = fixture.connection.sqlite
    .prepare('SELECT * FROM tasks WHERE project_slug = ?')
    .all('alpha');
  const reservations = fixture.connection.sqlite
    .prepare('SELECT * FROM task_emoji_reservations')
    .all();
  const before = ordinarySnapshot(fixture);
  expect(() =>
    api.archiveProject(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { affected_tasks: [] }, { revision: 1 }),
    ),
  ).toThrow();
  rejects(
    () =>
      api.archiveProject(
        fixture.human,
        'alpha',
        ordinaryInput(
          fixture,
          { affected_tasks: [{ task_id: task.id, expected_revision: 99 }] },
          { revision: 1 },
        ),
      ),
    'REVISION_CONFLICT',
  );
  expect(ordinarySnapshot(fixture)).toEqual(before);
  api.archiveProject(
    fixture.human,
    'alpha',
    ordinaryInput(
      fixture,
      { affected_tasks: [{ task_id: task.id, expected_revision: 1 }] },
      { revision: 1 },
    ),
  );
  expect(
    fixture.connection.sqlite.prepare('SELECT * FROM tasks WHERE project_slug = ?').all('alpha'),
  ).toEqual(children);
  expect(fixture.connection.sqlite.prepare('SELECT * FROM task_emoji_reservations').all()).toEqual(
    reservations,
  );
  const archived = ordinarySnapshot(fixture);
  rejects(
    () =>
      api.createTask(
        fixture.human,
        'alpha',
        ordinaryInput(fixture, { kind: 'ordinary', title: 'Запрещено' }),
      ),
    'VALIDATION_ERROR',
  );
  expect(() =>
    api.restoreProject(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { affected_tasks: [] }, { revision: 2 }),
    ),
  ).toThrow();
  expect(ordinarySnapshot(fixture)).toEqual(archived);
  api.restoreProject(
    fixture.human,
    'alpha',
    ordinaryInput(
      fixture,
      { affected_tasks: [{ task_id: task.id, expected_revision: 1 }] },
      { revision: 2 },
    ),
  );
  expect(
    fixture.connection.sqlite.prepare('SELECT * FROM tasks WHERE project_slug = ?').all('alpha'),
  ).toEqual(children);
  expect(fixture.connection.sqlite.prepare('SELECT * FROM task_emoji_reservations').all()).toEqual(
    reservations,
  );
});
it('uses strict ordinary overdue boundaries independently of archive filtering', async () => {
  const { isOrdinaryOverdue } = await ordinaryApi();
  const deadline = fixture.clock.now();
  for (const category of ['not_started', 'in_progress', 'review']) {
    expect(isOrdinaryOverdue({ category, deadline }, deadline - 1)).toBe(false);
    expect(isOrdinaryOverdue({ category, deadline }, deadline)).toBe(false);
    expect(isOrdinaryOverdue({ category, deadline }, deadline + 1)).toBe(true);
  }
  expect(isOrdinaryOverdue({ category: 'completed', deadline }, deadline + 1)).toBe(false);
  expect(isOrdinaryOverdue({ category: 'cancelled', deadline }, deadline + 1)).toBe(false);
  expect(isOrdinaryOverdue({ category: 'not_started', deadline: null }, deadline + 1)).toBe(false);
});
it('keeps scoped detail/list/basic pagination queries free of state, audit and receipt writes', async () => {
  const { api, task } = await initialWork(fixture);
  api.createTask(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { kind: 'ordinary', title: 'Вторая задача' }),
  );
  const before = ordinarySnapshot(fixture);
  expect(projectShape.parse(api.getProject(fixture.human, 'alpha').data).slug).toBe('alpha');
  expect(taskShape.parse(api.getTask(fixture.human, 'alpha', task.id).data).id).toBe(task.id);
  const projects = z
    .object({ items: z.array(projectShape), next_cursor: z.nullable(z.string()) })
    .parse(api.listProjects(fixture.human, { all_projects: true }).data);
  expect(projects.items.map((project) => project.slug).sort()).toEqual(['alpha', 'beta']);
  const page = z.object({ items: z.array(taskShape), next_cursor: z.nullable(z.string()) });
  const first = page.parse(api.listTasks(fixture.human, { project_slug: 'alpha', limit: 1 }).data);
  expect(first.items).toHaveLength(1);
  if (first.next_cursor === null) throw new Error('Expected a second task page');
  const second = page.parse(
    api.listTasks(fixture.human, { project_slug: 'alpha', limit: 1, cursor: first.next_cursor })
      .data,
  );
  expect(second.items).toHaveLength(1);
  expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  expect(() => api.getTask(fixture.human, 'beta', task.id)).toThrowError(
    expect.objectContaining({ code: 'PROJECT_MISMATCH' }),
  );
  expect(ordinarySnapshot(fixture)).toEqual(before);
});
