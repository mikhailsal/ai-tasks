import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import type { CoreContext, DatabaseTransaction } from '../../src/core/database/types.js';
import type { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import {
  mutationSuccessEnvelopeSchema,
  type MutationEnvelope,
} from '../../src/schema/envelopes.js';
import { taskDetailSchema, dependencyResourceSchema } from '../../src/schema/tasks.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import {
  createOrdinaryFixture,
  initialWork,
  ordinaryInput,
  ordinarySnapshot,
  durableCounts,
  invokeOrdinaryCli,
  customProjectConfig,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import { insertStorageRow, taskRow } from '../fixtures/storage-seed.js';
type Mutation = (
  context: CoreContext,
  slug: string,
  taskId: string,
  input: MutationEnvelope,
) => z.output<typeof mutationSuccessEnvelopeSchema>;
type Query = (
  context: CoreContext,
  slug: string,
  taskId: string,
) => z.output<typeof successEnvelopeSchema>;
// Deferred imports let the actual compiled-command RED run independently. Missing core modules are pending setup, never RED evidence.
async function dependencyApi() {
  const commandPath = '../../src/core/tasks/dependencies.js';
  const queryPath = '../../src/core/queries/dependencies.js';
  const [commands, queries]: unknown[] = await Promise.all([
    import(commandPath),
    import(queryPath),
  ]);
  const mutation = z.custom<Mutation>((value) => typeof value === 'function');
  return {
    ...z
      .object({
        addDependency: mutation,
        removeDependency: mutation,
        validateDependencyGraph: z.custom<(transaction: DatabaseTransaction) => void>(
          (value) => typeof value === 'function',
        ),
      })
      .parse(commands),
    ...z
      .object({ listDependencies: z.custom<Query>((value) => typeof value === 'function') })
      .parse(queries),
  };
}
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
});
afterEach(() => fixture?.close());
function snapshot() {
  return {
    ...ordinarySnapshot(fixture),
    dependencies: fixture.connection.sqlite
      .prepare('SELECT * FROM task_dependencies ORDER BY dependent_task_id, prerequisite_task_id')
      .all(),
  };
}
function reject(action: () => unknown, code: string) {
  expect(action).toThrowError(expect.objectContaining({ code }));
}
function seedTask(
  slug: string,
  status = 'idea',
  overrides: Record<string, string | number | null> = {},
) {
  const id = randomUUID();
  insertStorageRow(
    fixture.connection.sqlite,
    'tasks',
    taskRow({ id, project_slug: slug, status_id: status, ...overrides }),
  );
  return id;
}
function edgePayload(id: string, slug = 'beta') {
  return { prerequisite_task_id: id, prerequisite_project_slug: slug };
}
async function prepared(kind: 'add' | 'remove') {
  const work = await initialWork(fixture);
  const dependencies = await dependencyApi();
  if (kind === 'remove')
    dependencies.addDependency(
      fixture.human,
      'alpha',
      work.task.id,
      ordinaryInput(fixture, edgePayload(work.betaTask.id), { revision: 1 }),
    );
  const input = ordinaryInput(fixture, edgePayload(work.betaTask.id), {
    revision: kind === 'add' ? 1 : 2,
  });
  const command = kind === 'add' ? dependencies.addDependency : dependencies.removeDependency;
  const invoke = (request: MutationEnvelope, slug = 'alpha', context = fixture.human) =>
    command(context, slug, work.task.id, request);
  return { ...work, ...dependencies, input, invoke };
}
it('compiled dependency add dispatches valid input through the real command', async () => {
  const { task, betaTask } = await initialWork(fixture);
  const executable = invokeOrdinaryCli(fixture, ['version', '--json'], {});
  expect(executable.error).toBeUndefined();
  expect(executable.status, executable.stderr).toBe(0);
  const input = ordinaryInput(fixture, edgePayload(betaTask.id), { revision: 1 });
  const { payload, ...guards } = input;
  const result = invokeOrdinaryCli(
    fixture,
    ['dependency', 'add', task.id, '--project', 'alpha', '--input', '-', '--json'],
    jsonValueSchema.parse({ ...guards, ...edgePayload(betaTask.id) }),
  );
  expect(payload).toEqual(edgePayload(betaTask.id));
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(
    taskDetailSchema.parse(mutationSuccessEnvelopeSchema.parse(JSON.parse(result.stdout)).data),
  ).toMatchObject({ revision: 2, dependencies: [edgePayload(betaTask.id)] });
});
it.each(['add', 'remove'] as const)(
  '%s commits one parent revision, immutable audit/receipt and exact original replay',
  async (kind) => {
    const { task, betaTask, input, invoke, api } = await prepared(kind);
    const targetBefore = fixture.connection.sqlite
      .prepare('SELECT * FROM tasks WHERE id=?')
      .get(betaTask.id);
    const history = fixture.connection.sqlite
      .prepare('SELECT * FROM audit_records ORDER BY rowid')
      .all();
    const counts = durableCounts(fixture);
    const result = invoke(input);
    const resource = taskDetailSchema.parse(result.data);
    expect(resource).toMatchObject({
      id: task.id,
      revision: Number(input.expected_revision) + 1,
      status_id: 'idea',
      blocked: kind === 'add',
    });
    expect(resource.dependencies).toEqual(
      kind === 'add'
        ? [
            expect.objectContaining({
              ...edgePayload(betaTask.id),
              task_id: task.id,
              satisfied: false,
            }),
          ]
        : [],
    );
    expect(durableCounts(fixture)).toEqual({
      audit: Number(counts.audit) + 1,
      receipt: Number(counts.receipt) + 1,
    });
    const audits = fixture.connection.sqlite
      .prepare('SELECT * FROM audit_records ORDER BY rowid')
      .all();
    expect(audits.slice(0, history.length)).toEqual(history);
    expect(audits.at(-1)).toMatchObject({
      operation_id: input.operation_id,
      project_slug: 'alpha',
      entity_type: 'task',
      entity_id: task.id,
      actor: 'human-web',
      origin: 'web',
      action: `dependency.${kind}`,
      database_epoch: fixture.epoch,
    });
    expect(result.meta.audit_ids).toHaveLength(1);
    expect(
      fixture.connection.sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(betaTask.id),
    ).toEqual(targetBefore);
    const committed = snapshot();
    fixture.clock.advanceBy(5000);
    expect(invoke(input)).toEqual(result);
    for (const changed of [
      { ...input, expected_revision: 99 },
      { ...input, payload: edgePayload(task.id, 'alpha') },
    ])
      reject(() => invoke(changed), 'IDEMPOTENCY_CONFLICT');
    reject(() => invoke(input, 'alpha', fixture.agent('alpha')), 'IDEMPOTENCY_CONFLICT');
    reject(() => invoke(input, 'beta'), 'IDEMPOTENCY_CONFLICT');
    expect(snapshot()).toEqual(committed);
    api.updateTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(
        fixture,
        { description: 'A later independent edit' },
        { revision: resource.revision },
      ),
    );
    const later = snapshot();
    expect(invoke(input)).toEqual(result);
    expect(snapshot()).toEqual(later);
  },
);
it.each(['add', 'remove'] as const)(
  '%s rejects epoch/entity/config/missing revisions and malformed input with no durable changes',
  async (kind) => {
    const { input, invoke } = await prepared(kind);
    const before = snapshot();
    for (const [request, code] of [
      [{ ...input, database_epoch: randomUUID() }, 'DATABASE_EPOCH_CONFLICT'],
      [{ ...input, expected_revision: 99 }, 'REVISION_CONFLICT'],
      [{ ...input, expected_config_revision: 99 }, 'CONFIG_CONFLICT'],
      [
        { ...input, payload: { ...edgePayload(randomUUID()), unexpected: true } },
        'VALIDATION_ERROR',
      ],
      [
        {
          ...input,
          payload: { prerequisite_task_id: 'not-a-uuid', prerequisite_project_slug: 'beta' },
        },
        'VALIDATION_ERROR',
      ],
      [{ ...input, payload: { prerequisite_task_id: randomUUID() } }, 'VALIDATION_ERROR'],
    ] as const)
      reject(() => invoke(request), code);
    const { expected_revision: _entity, expected_config_revision: _config, ...missing } = input;
    expect(_entity).toBeGreaterThan(0);
    expect(_config).toBe(1);
    reject(() => invoke(missing), 'VALIDATION_ERROR');
    reject(
      () => invoke({ ...missing, expected_revision: input.expected_revision }),
      'VALIDATION_ERROR',
    );
    expect(snapshot()).toEqual(before);
  },
);
it.each(['add', 'remove'] as const)(
  '%s independently validates source owner and target project/UUID ownership',
  async (kind) => {
    const { input, invoke, task, addDependency, removeDependency } = await prepared(kind);
    const command = kind === 'add' ? addDependency : removeDependency;
    const before = snapshot();
    reject(() => invoke(input, 'beta'), 'PROJECT_MISMATCH');
    reject(
      () =>
        invoke({
          ...input,
          payload: { ...edgePayload(randomUUID()), prerequisite_task_id: task.id },
        }),
      'PROJECT_MISMATCH',
    );
    reject(() => invoke({ ...input, payload: edgePayload(randomUUID()) }), 'TASK_NOT_FOUND');
    reject(() => command(fixture.human, 'alpha', randomUUID(), input), 'TASK_NOT_FOUND');
    reject(() => invoke(input, 'absent'), 'PROJECT_NOT_FOUND');
    expect(snapshot()).toEqual(before);
  },
);
it.each(['add', 'remove'] as const)(
  '%s rolls back graph, parent revision and all history on late audit or receipt failure',
  async (kind) => {
    const { input, invoke } = await prepared(kind);
    const before = snapshot();
    for (const table of ['audit_records', 'operation_receipts']) {
      fixture.connection.sqlite.exec(
        `CREATE TRIGGER reject_dependency_history BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected late failure'); END`,
      );
      expect(() => invoke(input)).toThrow();
      expect(snapshot()).toEqual(before);
      fixture.connection.sqlite.exec('DROP TRIGGER reject_dependency_history');
    }
    expect(invoke(input)).toMatchObject({ ok: true });
  },
);
it.each(['add', 'remove'] as const)(
  '%s rejects mutation of archived source task or owning project',
  async (kind) => {
    const { input, invoke, task } = await prepared(kind);
    fixture.connection.sqlite
      .prepare('UPDATE tasks SET archived_at=? WHERE id=?')
      .run(fixture.clock.now(), task.id);
    let before = snapshot();
    reject(() => invoke(input), 'VALIDATION_ERROR');
    expect(snapshot()).toEqual(before);
    fixture.connection.sqlite.prepare('UPDATE tasks SET archived_at=NULL WHERE id=?').run(task.id);
    fixture.connection.sqlite
      .prepare("UPDATE projects SET archived_at=? WHERE slug='alpha'")
      .run(fixture.clock.now());
    before = snapshot();
    reject(() => invoke(input), 'VALIDATION_ERROR');
    expect(snapshot()).toEqual(before);
  },
);
it('dependency list is scoped and pure and reports satisfaction from categories, including archived prerequisites', async () => {
  const { task, listDependencies } = await prepared('add');
  const config = customProjectConfig();
  config.ordinary_workflow.statuses = config.ordinary_workflow.statuses.map((status) => ({
    ...status,
    label: status.id === 'finished' ? 'Не завершено' : status.label,
  }));
  config.ordinary_workflow.statuses.push({
    id: 'cancelled',
    label: 'Готово',
    category: 'cancelled',
  });
  const api = await initialWorkForGamma(config);
  const expected: {
    id: string;
    satisfied: boolean;
  }[] = [];
  for (const [status, archived, satisfied] of [
    ['finished', false, true],
    ['finished', true, true],
    ['cancelled', false, false],
    ['queued', true, false],
  ] as const) {
    const id = seedTask('gamma', status, { archived_at: archived ? fixture.clock.now() : null });
    const revision = expected.length + 1;
    api.addDependency(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, edgePayload(id, 'gamma'), { revision }),
    );
    expected.push({ id, satisfied });
  }
  const before = snapshot();
  const links = z
    .array(dependencyResourceSchema)
    .parse(listDependencies(fixture.human, 'alpha', task.id).data);
  expect(links).toHaveLength(4);
  for (const item of expected)
    expect(links).toContainEqual({
      task_id: task.id,
      prerequisite_task_id: item.id,
      prerequisite_project_slug: 'gamma',
      satisfied: item.satisfied,
    });
  reject(() => listDependencies(fixture.human, 'beta', task.id), 'PROJECT_MISMATCH');
  expect(snapshot()).toEqual(before);
});
async function initialWorkForGamma(config: JsonValue) {
  const { createProject } = await import('../../src/core/projects/commands.js');
  createProject(
    fixture.human,
    'gamma',
    ordinaryInput(
      fixture,
      { slug: 'gamma', name: 'Gamma', emoji: '🟡', config },
      { projectSlug: 'gamma' },
    ),
  );
  return dependencyApi();
}
it('rejects self-links, direct and transitive cross-project cycles without partial graph history', async () => {
  const { task, betaTask, addDependency } = await prepared('add');
  const third = seedTask('alpha');
  let before = snapshot();
  reject(
    () =>
      addDependency(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(fixture, edgePayload(task.id, 'alpha'), { revision: 1 }),
      ),
    'VALIDATION_ERROR',
  );
  expect(snapshot()).toEqual(before);
  addDependency(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(fixture, edgePayload(betaTask.id), { revision: 1 }),
  );
  before = snapshot();
  expect(() =>
    addDependency(
      fixture.human,
      'beta',
      betaTask.id,
      ordinaryInput(fixture, edgePayload(task.id, 'alpha'), { projectSlug: 'beta', revision: 1 }),
    ),
  ).toThrowError(
    expect.objectContaining({
      code: 'DEPENDENCY_BLOCKED',
      details: expect.objectContaining({ reason: 'cycle' }),
    }),
  );
  expect(snapshot()).toEqual(before);
  addDependency(
    fixture.human,
    'beta',
    betaTask.id,
    ordinaryInput(fixture, edgePayload(third, 'alpha'), { projectSlug: 'beta', revision: 1 }),
  );
  before = snapshot();
  reject(
    () =>
      addDependency(
        fixture.human,
        'alpha',
        third,
        ordinaryInput(fixture, edgePayload(task.id, 'alpha'), { revision: 1 }),
      ),
    'DEPENDENCY_BLOCKED',
  );
  expect(snapshot()).toEqual(before);
});
it.each(['add', 'remove'] as const)(
  '%s rejects recurring task endpoints on either side of a link',
  async (kind) => {
    const { task, input, addDependency, removeDependency } = await prepared('add');
    const source = seedTask('alpha', 'draft', { kind: 'recurring' });
    const target = seedTask('beta', 'draft', { kind: 'recurring' });
    const command = kind === 'add' ? addDependency : removeDependency;
    const before = snapshot();
    reject(() => command(fixture.human, 'alpha', source, input), 'VALIDATION_ERROR');
    reject(
      () => command(fixture.human, 'alpha', task.id, { ...input, payload: edgePayload(target) }),
      'VALIDATION_ERROR',
    );
    expect(snapshot()).toEqual(before);
  },
);
it.each(['in_progress', 'sanity_check', 'done'])(
  'rejects unmet prerequisite addition to %s but permits an archived completed prerequisite without moving it',
  async (status) => {
    const { betaTask, addDependency } = await prepared('add');
    const source = seedTask('alpha', status);
    const completed = seedTask('beta', 'done', { archived_at: fixture.clock.now() });
    fixture.connection.sqlite
      .prepare("UPDATE projects SET archived_at=? WHERE slug='beta'")
      .run(fixture.clock.now());
    const before = snapshot();
    reject(
      () =>
        addDependency(
          fixture.human,
          'alpha',
          source,
          ordinaryInput(fixture, edgePayload(betaTask.id), { revision: 1 }),
        ),
      'DEPENDENCY_BLOCKED',
    );
    expect(snapshot()).toEqual(before);
    const result = taskDetailSchema.parse(
      addDependency(
        fixture.human,
        'alpha',
        source,
        ordinaryInput(fixture, edgePayload(completed), { revision: 1 }),
      ).data,
    );
    expect(result).toMatchObject({
      status_id: status,
      revision: 2,
      blocked: false,
      dependencies: [{ satisfied: true, prerequisite_task_id: completed }],
    });
  },
);
it('enforces 100 total prerequisites while removal releases capacity without changing status', async () => {
  const { task, addDependency, removeDependency } = await prepared('add');
  const targets = Array.from({ length: 101 }, () => seedTask('beta'));
  const first = targets.slice(0, 99);
  fixture.connection.sqlite.transaction(() => {
    for (const id of first)
      insertStorageRow(fixture.connection.sqlite, 'task_dependencies', {
        dependent_task_id: task.id,
        dependent_project_slug: 'alpha',
        prerequisite_task_id: id,
        prerequisite_project_slug: 'beta',
        created_at: fixture.clock.now(),
        created_operation_id: randomUUID(),
      });
  })();
  const hundredth = targets[99];
  const overflow = targets[100];
  if (!hundredth || !overflow || !first[0]) throw new Error('Missing prerequisite fixture row');
  const added = taskDetailSchema.parse(
    addDependency(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, edgePayload(hundredth), { revision: 1 }),
    ).data,
  );
  expect(added.dependencies).toHaveLength(100);
  const before = snapshot();
  reject(
    () =>
      addDependency(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(fixture, edgePayload(overflow), { revision: 2 }),
      ),
    'VALIDATION_ERROR',
  );
  expect(snapshot()).toEqual(before);
  const removed = taskDetailSchema.parse(
    removeDependency(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, edgePayload(first[0]), { revision: 2 }),
    ).data,
  );
  expect(removed).toMatchObject({ status_id: 'idea', revision: 3 });
  expect(removed.dependencies).toHaveLength(99);
  expect(
    taskDetailSchema.parse(
      addDependency(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(fixture, edgePayload(overflow), { revision: 3 }),
      ).data,
    ).dependencies,
  ).toHaveLength(100);
});
it('requires every prerequisite completed and reopening one leaves dependent data unchanged until its next guarded transition', async () => {
  const { task, api, addDependency, removeDependency } = await prepared('add');
  const first = seedTask('beta', 'done');
  const second = seedTask('beta');
  let dependent = taskDetailSchema.parse(
    addDependency(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, edgePayload(first), { revision: 1 }),
    ).data,
  );
  dependent = taskDetailSchema.parse(
    addDependency(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, edgePayload(second), { revision: dependent.revision }),
    ).data,
  );
  for (const status of ['planning', 'ready'])
    dependent = taskDetailSchema.parse(
      api.transitionTask(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(fixture, { to_status_id: status }, { revision: dependent.revision }),
      ).data,
    );
  let before = snapshot();
  reject(
    () =>
      api.transitionTask(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(fixture, { to_status_id: 'in_progress' }, { revision: dependent.revision }),
      ),
    'DEPENDENCY_BLOCKED',
  );
  expect(snapshot()).toEqual(before);
  fixture.connection.sqlite
    .prepare("UPDATE tasks SET status_id='cancelled' WHERE id=?")
    .run(second);
  reject(
    () =>
      api.transitionTask(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(fixture, { to_status_id: 'in_progress' }, { revision: dependent.revision }),
      ),
    'DEPENDENCY_BLOCKED',
  );
  fixture.connection.sqlite.prepare("UPDATE tasks SET status_id='done' WHERE id=?").run(second);
  dependent = taskDetailSchema.parse(
    api.transitionTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, { to_status_id: 'in_progress' }, { revision: dependent.revision }),
    ).data,
  );
  const unchanged = fixture.connection.sqlite
    .prepare('SELECT * FROM tasks WHERE id=?')
    .get(task.id);
  api.transitionTask(
    fixture.human,
    'beta',
    first,
    ordinaryInput(fixture, { to_status_id: 'in_progress' }, { projectSlug: 'beta', revision: 1 }),
  );
  expect(fixture.connection.sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(task.id)).toEqual(
    unchanged,
  );
  expect(taskDetailSchema.parse(api.getTask(fixture.human, 'alpha', task.id).data)).toMatchObject({
    blocked: true,
    status_id: 'in_progress',
    revision: dependent.revision,
  });
  before = snapshot();
  reject(
    () =>
      api.transitionTask(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(fixture, { to_status_id: 'sanity_check' }, { revision: dependent.revision }),
      ),
    'DEPENDENCY_BLOCKED',
  );
  expect(snapshot()).toEqual(before);
  expect(
    taskDetailSchema.parse(
      removeDependency(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(fixture, edgePayload(first), { revision: dependent.revision }),
      ).data,
    ),
  ).toMatchObject({ blocked: false, status_id: 'in_progress' });
});
it('global structural graph validation is pure for blocked advanced dependents and rejects a staged cycle atomically', async () => {
  const { task, betaTask, validateDependencyGraph } = await prepared('add');
  fixture.connection.sqlite
    .prepare("UPDATE tasks SET status_id='in_progress' WHERE id=?")
    .run(task.id);
  insertStorageRow(fixture.connection.sqlite, 'task_dependencies', {
    dependent_task_id: task.id,
    dependent_project_slug: 'alpha',
    prerequisite_task_id: betaTask.id,
    prerequisite_project_slug: 'beta',
    created_at: fixture.clock.now(),
    created_operation_id: randomUUID(),
  });
  const before = snapshot();
  expect(() =>
    fixture.connection.db.transaction((transaction) => validateDependencyGraph(transaction)),
  ).not.toThrow();
  expect(snapshot()).toEqual(before);
  reject(
    () =>
      fixture.connection.db.transaction((transaction) => {
        insertStorageRow(fixture.connection.sqlite, 'task_dependencies', {
          dependent_task_id: betaTask.id,
          dependent_project_slug: 'beta',
          prerequisite_task_id: task.id,
          prerequisite_project_slug: 'alpha',
          created_at: fixture.clock.now(),
          created_operation_id: randomUUID(),
        });
        validateDependencyGraph(transaction);
      }),
    'DEPENDENCY_BLOCKED',
  );
  expect(snapshot()).toEqual(before);
});
