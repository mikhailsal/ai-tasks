import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/mini';
import { createProject, updateProject, archiveProject } from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { getProjectConfiguration } from '../../src/core/queries/configuration.js';
import { getTask } from '../../src/core/queries/tasks.js';
import {
  projectConfigInputSchema,
  priorityValueSchema,
  type ProjectConfigInput,
} from '../../src/schema/configuration.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import {
  configurationApi,
  configurationSnapshot,
  configurationTask,
  migrationInput,
  migrationPayload,
  seedConfigurationDependency,
  taskRows,
  invalidConfigurations,
  assertAdvancedProjection,
  assertCrossProjectProjection,
  assertEmojiProjection,
  type MigrationPayload,
} from '../fixtures/configuration.js';
import {
  createOrdinaryFixture,
  invokeOrdinaryCli,
  ordinaryInput,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Альфа', emoji: '🚀' }),
  );
});
afterEach(() => fixture?.close());
it('compiled CLI previews a real valid project configuration [US2 behavioral red]', () => {
  const result = invokeOrdinaryCli(
    fixture,
    ['config', 'preview', '--project', 'alpha', '--json', '--input', '-'],
    jsonValueSchema.parse({
      config: createDefaultProjectConfig(),
      status_mappings: [],
      priority_mappings: [],
      affected_tasks: [],
    }),
  );
  expect(result.status, `Expected configuration preview success; stderr=${result.stderr}`).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: true,
    data: {
      affected_tasks: [],
      required_status_mappings: [],
      required_priority_mappings: [],
      issues: [],
    },
  });
});
function renamedStatus(from = 'idea', to = 'queued'): ProjectConfigInput {
  const config = createDefaultProjectConfig();
  const workflow = config.ordinary_workflow;
  workflow.initial_status_id =
    workflow.initial_status_id === from ? to : workflow.initial_status_id;
  workflow.statuses = workflow.statuses.map((status) =>
    status.id === from ? { ...status, id: to } : status,
  );
  workflow.transitions = workflow.transitions.map((edge) => ({
    ...edge,
    from: edge.from === from ? to : edge.from,
    to: edge.to === from ? to : edge.to,
  }));
  return config;
}
function changedPayload(
  tasks: {
    id: string;
    revision: number;
  }[],
): MigrationPayload {
  return migrationPayload(renamedStatus(), {
    status_mappings: [{ kind: 'ordinary', from_status_id: 'idea', to_status_id: 'queued' }],
    affected_tasks: tasks.map((task) => ({ task_id: task.id, expected_revision: task.revision })),
  });
}
function rejects(action: () => unknown, code: string) {
  expect(action).toThrowError(expect.objectContaining({ code }));
}
it('preview reports unresolved used mappings and affected revisions without reserving or writing', async () => {
  const api = await configurationApi();
  const active = configurationTask(fixture, { emoji: '🧪' });
  const archived = configurationTask(fixture, { archived: true });
  const before = configurationSnapshot(fixture);
  const preview = api.previewConfiguration(
    fixture.human,
    'alpha',
    migrationPayload(renamedStatus()),
  );
  expect(preview).toMatchObject({
    ok: true,
    data: {
      affected_tasks: expect.arrayContaining([
        { task_id: active.id, expected_revision: 1 },
        { task_id: archived.id, expected_revision: 1 },
      ]),
      required_status_mappings: [{ kind: 'ordinary', from_status_id: 'idea' }],
      required_priority_mappings: [],
      issues: expect.any(Array),
    },
  });
  expect(preview.data.issues.length).toBeGreaterThan(0);
  expect(configurationSnapshot(fixture)).toEqual(before);
  const resolved = api.previewConfiguration(
    fixture.human,
    'alpha',
    changedPayload([active, archived]),
  );
  expect(resolved.data.issues).toEqual([]);
  expect(configurationSnapshot(fixture)).toEqual(before);
});
it('migration commits all changed archived/active rows, config semantics, audit and receipt atomically', async () => {
  const api = await configurationApi();
  const active = configurationTask(fixture, { emoji: '🧪' });
  const archived = configurationTask(fixture, { archived: true });
  const beforeHistory = fixture.connection.sqlite
    .prepare('SELECT * FROM audit_records ORDER BY rowid')
    .all();
  const oldConfig = getProjectConfiguration(fixture.human, 'alpha').data;
  fixture.clock.advanceBy(1234);
  const input = migrationInput(fixture, changedPayload([active, archived]));
  const result = api.migrateConfiguration(fixture.human, 'alpha', input);
  expect(result.data).toMatchObject({
    config: { ...renamedStatus(), revision: 2 },
    affected_tasks: expect.arrayContaining([
      { task_id: active.id, revision: 2 },
      { task_id: archived.id, revision: 2 },
    ]),
  });
  for (const task of [active, archived]) {
    expect(getTask(fixture.human, 'alpha', task.id).data).toMatchObject({
      status_id: 'queued',
      revision: 2,
      config_revision: 2,
      archived_at: task.archived_at,
    });
  }
  const snapshots = fixture.connection.sqlite
    .prepare('SELECT revision,semantic_snapshot FROM project_configs ORDER BY revision')
    .all();
  expect(snapshots).toHaveLength(2);
  expect(snapshots[0]).toMatchObject({ revision: 1 });
  expect(getProjectConfiguration(fixture.human, 'alpha').data.revision).toBe(2);
  expect(result.meta.audit_ids).toHaveLength(3);
  const events = z
    .array(
      z.object({
        entity_type: z.string(),
        entity_id: z.string(),
        changes: z.string(),
        config_snapshot: z.string(),
      }),
    )
    .parse(
      fixture.connection.sqlite
        .prepare(
          'SELECT entity_type,entity_id,changes,config_snapshot FROM audit_records WHERE operation_id = ? ORDER BY entity_type,entity_id',
        )
        .all(input.operation_id),
    );
  for (const event of events.filter((event) => event.entity_type === 'task')) {
    expect(JSON.parse(event.changes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'status_id', before: 'idea', after: 'queued' }),
      ]),
    );
    // The event contains the full new meaning; the earlier immutable task event retains oldConfig.
    expect(JSON.parse(event.config_snapshot)).toMatchObject({ revision: 2, ...renamedStatus() });
    expect(JSON.parse(event.config_snapshot)).toMatchObject({ previous: oldConfig });
  }
  const history = fixture.connection.sqlite
    .prepare('SELECT * FROM audit_records ORDER BY rowid')
    .all();
  expect(history.slice(0, beforeHistory.length)).toEqual(beforeHistory);
  expect(oldConfig.ordinary_workflow.initial_status_id).toBe('idea');
  const receipt = z
    .object({ result: z.string() })
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT result FROM operation_receipts WHERE operation_id = ?')
        .get(input.operation_id),
    );
  expect(JSON.parse(receipt.result)).toEqual(result);
});
it.each(invalidConfigurations())(
  'rejects structurally invalid proposed config %j without any writes',
  async (config) => {
    const api = await configurationApi();
    const before = configurationSnapshot(fixture);
    const payload = { config, status_mappings: [], priority_mappings: [], affected_tasks: [] };
    rejects(() => api.previewConfiguration(fixture.human, 'alpha', payload), 'VALIDATION_ERROR');
    rejects(
      () =>
        api.migrateConfiguration(
          fixture.human,
          'alpha',
          ordinaryInput(fixture, payload, { revision: 1 }),
        ),
      'VALIDATION_ERROR',
    );
    expect(configurationSnapshot(fixture)).toEqual(before);
  },
);
it.each(['category', 'status', 'completed-together', 'priority-only'] as const)(
  'validates complete projected dependency state for %s changes',
  async (mode) => {
    await assertAdvancedProjection(fixture, mode);
  },
);
it('allows unchanged advanced cross-project dependents to remain blocked after prerequisite remapping', async () => {
  await assertCrossProjectProjection(fixture);
});
it.each(['occupied', 'two-returning', 'release-before-acquire'] as const)(
  'validates all projected emoji reservations atomically: %s',
  async (mode) => {
    await assertEmojiProjection(fixture, mode);
  },
);
it('rejects migration under an archived owning project without changing archived task/config history', async () => {
  const api = await configurationApi();
  const task = configurationTask(fixture, { archived: true });
  archiveProject(
    fixture.human,
    'alpha',
    ordinaryInput(
      fixture,
      {
        affected_tasks: [{ task_id: task.id, expected_revision: 1 }],
      },
      { revision: 1 },
    ),
  );
  const before = configurationSnapshot(fixture);
  rejects(
    () =>
      api.migrateConfiguration(
        fixture.human,
        'alpha',
        migrationInput(fixture, changedPayload([task])),
      ),
    'VALIDATION_ERROR',
  );
  expect(configurationSnapshot(fixture)).toEqual(before);
});
it('replays before stale config/task checks and rejects changed payload, actor or scope identity', async () => {
  const api = await configurationApi();
  const task = configurationTask(fixture);
  const input = migrationInput(fixture, changedPayload([task]));
  const result = api.migrateConfiguration(fixture.human, 'alpha', input);
  const committed = configurationSnapshot(fixture);
  fixture.clock.advanceBy(1000);
  expect(api.migrateConfiguration(fixture.human, 'alpha', input)).toEqual(result);
  for (const change of [
    { ...input, expected_revision: 99 },
    { ...input, payload: jsonValueSchema.parse(migrationPayload(createDefaultProjectConfig())) },
  ])
    rejects(() => api.migrateConfiguration(fixture.human, 'alpha', change), 'IDEMPOTENCY_CONFLICT');
  rejects(
    () => api.migrateConfiguration(fixture.agent('alpha'), 'alpha', input),
    'IDEMPOTENCY_CONFLICT',
  );
  rejects(() => api.migrateConfiguration(fixture.human, 'beta', input), 'IDEMPOTENCY_CONFLICT');
  expect(configurationSnapshot(fixture)).toEqual(committed);
  fixture.connection.sqlite
    .prepare('UPDATE application_state SET database_epoch = ?')
    .run(randomUUID());
  const replaced = configurationSnapshot(fixture);
  rejects(() => api.migrateConfiguration(fixture.human, 'alpha', input), 'DATABASE_EPOCH_CONFLICT');
  expect(configurationSnapshot(fixture)).toEqual(replaced);
});
it.each(['epoch', 'revision', 'config', 'task', 'actor'] as const)(
  'rejects stale/invalid %s guards before committing migration',
  async (guard) => {
    const api = await configurationApi();
    const task = configurationTask(fixture);
    const payload = changedPayload([task]);
    if (guard === 'task') payload.affected_tasks[0] = { task_id: task.id, expected_revision: 99 };
    const input = migrationInput(fixture, payload);
    const request = {
      ...input,
      ...(guard === 'epoch' ? { database_epoch: randomUUID() } : {}),
      ...(guard === 'revision' ? { expected_revision: 99 } : {}),
      ...(guard === 'config' ? { expected_config_revision: 99 } : {}),
    };
    const before = configurationSnapshot(fixture);
    rejects(
      () =>
        api.migrateConfiguration(
          guard === 'actor' ? fixture.agent('beta') : fixture.human,
          'alpha',
          request,
        ),
      guard === 'epoch'
        ? 'DATABASE_EPOCH_CONFLICT'
        : guard === 'actor'
          ? 'VALIDATION_ERROR'
          : guard === 'config'
            ? 'CONFIG_CONFLICT'
            : 'REVISION_CONFLICT',
    );
    expect(configurationSnapshot(fixture)).toEqual(before);
  },
);
it('uses the config revision token even after an unrelated project entity edit', async () => {
  const api = await configurationApi();
  updateProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { name: 'Новая подпись' }, { revision: 1 }),
  );
  const config = createDefaultProjectConfig();
  config.ordinary_workflow.statuses[0] = { id: 'idea', label: 'Замысел', category: 'not_started' };
  const input = migrationInput(fixture, migrationPayload(config));
  expect(input.expected_revision).toBe(1);
  expect(api.migrateConfiguration(fixture.human, 'alpha', input).data.config.revision).toBe(2);
});
it.each(['audit_records', 'operation_receipts'] as const)(
  'rolls back config, mapped tasks, graph and reservations on %s insert failure',
  async (table) => {
    const api = await configurationApi();
    const task = configurationTask(fixture, { emoji: '🧪' });
    const input = migrationInput(fixture, changedPayload([task]));
    const before = configurationSnapshot(fixture);
    fixture.connection.sqlite.exec(
      `CREATE TRIGGER reject_migration BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'migration persistence failure'); END`,
    );
    expect(() => api.migrateConfiguration(fixture.human, 'alpha', input)).toThrow();
    expect(configurationSnapshot(fixture)).toEqual(before);
    fixture.connection.sqlite.exec('DROP TRIGGER reject_migration');
    expect(api.migrateConfiguration(fixture.human, 'alpha', input).ok).toBe(true);
  },
);
it.each(['label', 'color', 'edge'] as const)(
  '%s-only configuration changes revision without rewriting blocked task rows',
  async (kind) => {
    const api = await configurationApi();
    const task = configurationTask(fixture, { status: 'in_progress' });
    const prerequisite = configurationTask(fixture);
    seedConfigurationDependency(fixture, task, prerequisite);
    const config = createDefaultProjectConfig();
    if (kind === 'label')
      config.ordinary_workflow.statuses[0] = {
        id: 'idea',
        label: 'Новая подпись',
        category: 'not_started',
      };
    if (kind === 'color')
      config.ordinary_workflow.statuses[0] = {
        id: 'idea',
        label: 'Идея',
        category: 'not_started',
        color: 'rose',
      };
    if (kind === 'edge') config.ordinary_workflow.transitions = [];
    const rows = taskRows(fixture);
    fixture.clock.advanceBy(10000);
    const result = api.migrateConfiguration(
      fixture.human,
      'alpha',
      migrationInput(fixture, migrationPayload(config)),
    );
    expect(result.data).toMatchObject({ config: { revision: 2 }, affected_tasks: [] });
    expect(taskRows(fixture)).toEqual(rows);
    expect(getTask(fixture.human, 'alpha', task.id).data.revision).toBe(1);
    expect(result.meta.audit_ids).toHaveLength(1);
  },
);
it.each([
  'missing',
  'duplicate',
  'unknown-source',
  'unknown-target',
  'wrong-kind',
  'extraneous',
  'missing-archived',
  'duplicate-task',
  'unknown-task',
  'foreign-task',
] as const)(
  'preview reports and commit rejects %s migration mappings or affected IDs atomically',
  async (invalid) => {
    const api = await configurationApi();
    const task = configurationTask(fixture);
    const archived = configurationTask(fixture, { archived: true });
    const proposal = changedPayload([task, archived]);
    if (invalid === 'missing') proposal.status_mappings = [];
    if (invalid === 'duplicate')
      proposal.status_mappings.push({
        kind: 'ordinary',
        from_status_id: 'idea',
        to_status_id: 'queued',
      });
    if (invalid === 'unknown-source')
      proposal.status_mappings[0] = {
        kind: 'ordinary',
        from_status_id: 'missing',
        to_status_id: 'queued',
      };
    if (invalid === 'unknown-target')
      proposal.status_mappings[0] = {
        kind: 'ordinary',
        from_status_id: 'idea',
        to_status_id: 'missing',
      };
    if (invalid === 'wrong-kind')
      proposal.status_mappings[0] = {
        kind: 'recurring',
        from_status_id: 'idea',
        to_status_id: 'queued',
      };
    if (invalid === 'extraneous')
      proposal.status_mappings.push({
        kind: 'ordinary',
        from_status_id: 'planning',
        to_status_id: 'queued',
      });
    if (invalid === 'missing-archived')
      proposal.affected_tasks = [{ task_id: task.id, expected_revision: 1 }];
    if (invalid === 'duplicate-task')
      proposal.affected_tasks.push({ task_id: task.id, expected_revision: 1 });
    if (invalid === 'unknown-task')
      proposal.affected_tasks.push({ task_id: randomUUID(), expected_revision: 1 });
    if (invalid === 'foreign-task') {
      createProject(
        fixture.human,
        'beta',
        ordinaryInput(
          fixture,
          { slug: 'beta', name: 'Бета', emoji: '🌲' },
          { projectSlug: 'beta' },
        ),
      );
      const foreign = configurationTask(fixture, { projectSlug: 'beta' });
      proposal.affected_tasks.push({ task_id: foreign.id, expected_revision: 1 });
    }
    const before = configurationSnapshot(fixture);
    const preview = api.previewConfiguration(fixture.human, 'alpha', proposal);
    expect(preview.data.issues.length).toBeGreaterThan(0);
    expect(configurationSnapshot(fixture)).toEqual(before);
    rejects(
      () => api.migrateConfiguration(fixture.human, 'alpha', migrationInput(fixture, proposal)),
      invalid === 'foreign-task'
        ? 'PROJECT_MISMATCH'
        : invalid === 'unknown-task'
          ? 'TASK_NOT_FOUND'
          : 'VALIDATION_ERROR',
    );
    expect(configurationSnapshot(fixture)).toEqual(before);
  },
);
const priorityTargets: {
  model: JsonValue;
  value: JsonValue;
}[] = [
  { model: { type: 'classic' }, value: { model: 'classic', level: 'high' } },
  { model: { type: 'eisenhower' }, value: { model: 'eisenhower', important: true, urgent: false } },
  {
    model: { type: 'named', levels: [{ id: 'urgent', label: 'Срочно', color: 'red' }] },
    value: { model: 'named', level_id: 'urgent' },
  },
  {
    model: { type: 'numeric', min: -1000000000, max: 1000000000, direction: 'higher' },
    value: { model: 'numeric', value: 1.001 },
  },
];
it.each(priorityTargets)(
  'migrates exact priorities into usable $model configuration without converting unset',
  async ({ model, value }) => {
    const api = await configurationApi();
    const assigned = configurationTask(fixture, { priority: { model: 'classic', level: 'high' } });
    const unset = configurationTask(fixture);
    const config = projectConfigInputSchema.parse({
      ...createDefaultProjectConfig(),
      priority_model: model,
    });
    config.ordinary_workflow.statuses[0] = { id: 'idea', label: 'Начало', category: 'not_started' };
    const changed = config.priority_model.type !== 'classic';
    const proposal = migrationPayload(
      config,
      changed
        ? {
            priority_mappings: [
              { from: { model: 'classic', level: 'high' }, to: priorityValueSchema.parse(value) },
            ],
            affected_tasks: [{ task_id: assigned.id, expected_revision: 1 }],
          }
        : {},
    );
    const before = configurationSnapshot(fixture);
    const preview = api.previewConfiguration(fixture.human, 'alpha', proposal);
    expect(preview.data.issues).toEqual([]);
    expect(configurationSnapshot(fixture)).toEqual(before);
    api.migrateConfiguration(fixture.human, 'alpha', migrationInput(fixture, proposal));
    expect(getTask(fixture.human, 'alpha', assigned.id).data.priority).toEqual(value);
    expect(getTask(fixture.human, 'alpha', unset.id).data).toMatchObject({
      priority: null,
      revision: 1,
    });
    if (config.priority_model.type === 'numeric')
      expect(
        fixture.connection.sqlite
          .prepare('SELECT priority_scaled FROM tasks WHERE id = ?')
          .pluck()
          .get(assigned.id),
      ).toBe(1001);
  },
);
it.each([-1000000000, 1000000000, -0.001, 1.001])(
  'retains exact numeric boundary/precision %s without rounding',
  async (value) => {
    const api = await configurationApi();
    const task = configurationTask(fixture, {
      priority: { model: 'classic', level: 'low' },
      archived: true,
    });
    const config = createDefaultProjectConfig();
    config.priority_model = {
      type: 'numeric',
      min: -1000000000,
      max: 1000000000,
      direction: 'lower',
    };
    const proposal = migrationPayload(config, {
      priority_mappings: [
        { from: { model: 'classic', level: 'low' }, to: { model: 'numeric', value } },
      ],
      affected_tasks: [{ task_id: task.id, expected_revision: 1 }],
    });
    api.migrateConfiguration(fixture.human, 'alpha', migrationInput(fixture, proposal));
    expect(getTask(fixture.human, 'alpha', task.id).data.priority).toEqual({
      model: 'numeric',
      value,
    });
  },
);
it.each(['missing', 'duplicate', 'unknown', 'extraneous', 'invalid-target'] as const)(
  'rejects %s priority mappings without partial conversion',
  async (invalid) => {
    const api = await configurationApi();
    const task = configurationTask(fixture, { priority: { model: 'classic', level: 'high' } });
    const config = createDefaultProjectConfig();
    config.priority_model = { type: 'numeric', min: 0, max: 10, direction: 'higher' };
    const proposal = migrationPayload(config, {
      priority_mappings: [
        { from: { model: 'classic', level: 'high' }, to: { model: 'numeric', value: 1.001 } },
      ],
      affected_tasks: [{ task_id: task.id, expected_revision: 1 }],
    });
    if (invalid === 'missing') proposal.priority_mappings = [];
    if (invalid === 'duplicate')
      proposal.priority_mappings.push({ from: { model: 'classic', level: 'high' }, to: null });
    if (invalid === 'unknown')
      proposal.priority_mappings[0] = { from: { model: 'named', level_id: 'absent' }, to: null };
    if (invalid === 'extraneous')
      proposal.priority_mappings.push({ from: null, to: { model: 'numeric', value: 1 } });
    if (invalid === 'invalid-target')
      proposal.priority_mappings[0] = {
        from: { model: 'classic', level: 'high' },
        to: { model: 'numeric', value: 10.001 },
      };
    const before = configurationSnapshot(fixture);
    const preview = api.previewConfiguration(fixture.human, 'alpha', proposal);
    expect(preview.data.issues.length).toBeGreaterThan(0);
    expect(preview.data.required_priority_mappings).toContainEqual({
      from: { model: 'classic', level: 'high' },
    });
    rejects(
      () => api.migrateConfiguration(fixture.human, 'alpha', migrationInput(fixture, proposal)),
      'VALIDATION_ERROR',
    );
    expect(configurationSnapshot(fixture)).toEqual(before);
  },
);
it('named label/color/order changes preserve named values and blocked advanced task revisions', async () => {
  const api = await configurationApi();
  const config = createDefaultProjectConfig();
  config.priority_model = {
    type: 'named',
    levels: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
  };
  api.migrateConfiguration(
    fixture.human,
    'alpha',
    migrationInput(fixture, migrationPayload(config)),
  );
  const task = configurationTask(fixture, {
    status: 'in_progress',
    priority: { model: 'named', level_id: 'a' },
  });
  const prerequisite = configurationTask(fixture);
  seedConfigurationDependency(fixture, task, prerequisite);
  const before = taskRows(fixture);
  config.priority_model = {
    type: 'named',
    levels: [
      { id: 'b', label: 'Первый', color: 'blue' },
      { id: 'a', label: 'Второй', color: 'rose' },
    ],
  };
  const result = api.migrateConfiguration(
    fixture.human,
    'alpha',
    migrationInput(fixture, migrationPayload(config)),
  );
  expect(result.data.affected_tasks).toEqual([]);
  expect(taskRows(fixture)).toEqual(before);
});
it('requires explicit acceptance of an in-use category change even at the same stable status ID', async () => {
  const api = await configurationApi();
  const task = configurationTask(fixture, { status: 'ready' });
  const config = createDefaultProjectConfig();
  config.ordinary_workflow.statuses = config.ordinary_workflow.statuses.map((status) =>
    status.id === 'ready' ? { ...status, category: 'in_progress' } : status,
  );
  const before = configurationSnapshot(fixture);
  const proposal = migrationPayload(config);
  const preview = api.previewConfiguration(fixture.human, 'alpha', proposal);
  expect(preview.data.required_status_mappings).toContainEqual({
    kind: 'ordinary',
    from_status_id: 'ready',
  });
  rejects(
    () => api.migrateConfiguration(fixture.human, 'alpha', migrationInput(fixture, proposal)),
    'VALIDATION_ERROR',
  );
  expect(configurationSnapshot(fixture)).toEqual(before);
  proposal.status_mappings = [{ kind: 'ordinary', from_status_id: 'ready', to_status_id: 'ready' }];
  proposal.affected_tasks = [{ task_id: task.id, expected_revision: 1 }];
  const result = api.migrateConfiguration(
    fixture.human,
    'alpha',
    migrationInput(fixture, proposal),
  );
  expect(result.data.affected_tasks).toEqual([{ task_id: task.id, revision: 2 }]);
  expect(getTask(fixture.human, 'alpha', task.id).data).toMatchObject({
    status_id: 'ready',
    category: 'in_progress',
    revision: 2,
  });
});
it('accepts exactly 100 distinct named levels and ordinary statuses with stable keys', async () => {
  const api = await configurationApi();
  const config = createDefaultProjectConfig();
  config.priority_model = {
    type: 'named',
    levels: Array.from({ length: 100 }, (_, index) => ({
      id: `n_${index}`,
      label: `Уровень ${index}`,
    })),
  };
  config.ordinary_workflow.statuses = Array.from({ length: 100 }, (_, index) => ({
    id: index === 0 ? 'idea' : `status_${index}`,
    label: `Статус ${index}`,
    category: 'not_started',
  }));
  config.ordinary_workflow.transitions = [];
  const result = api.migrateConfiguration(
    fixture.human,
    'alpha',
    migrationInput(fixture, migrationPayload(config)),
  );
  expect(result.data.config.ordinary_workflow.statuses).toHaveLength(100);
  expect(result.data.config.priority_model).toEqual(config.priority_model);
});
