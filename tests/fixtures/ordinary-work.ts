import type { CoreContext } from '../../src/core/database/types.js';
import type { MutationEnvelope } from '../../src/schema/envelopes.js';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { z } from 'zod/mini';
import { createContext } from '../../src/core/context.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { mutationEnvelopeSchema } from '../../src/schema/envelopes.js';
import type { JsonValue } from '../../src/schema/values.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createTestClock } from './clock.js';
import { createDatabaseFixture } from './database.js';
export async function createOrdinaryFixture() {
  const clock = createTestClock(Date.UTC(2026, 9, 21, 10, 0, 0, 123));
  let connection: ReturnType<typeof openDatabase> | undefined;
  const fixture = await createDatabaseFixture(
    {
      acquireDatabaseLock,
      releaseDatabaseLock,
      openDatabase(input) {
        connection = openDatabase(input);
        return connection;
      },
      migrateDatabase,
    },
    clock,
  );
  if (!connection) throw new Error('Production database fixture did not open');
  const opened = connection;
  const state = z
    .object({ database_epoch: z.uuid() })
    .parse(
      opened.sqlite.prepare('SELECT database_epoch FROM application_state WHERE id = 1').get(),
    );
  return {
    ...fixture,
    connection: opened,
    clock,
    epoch: state.database_epoch,
    human: createContext({ connection: opened, actor: 'human-web', now: clock.now }),
    agent: (slug: string) =>
      createContext({ connection: opened, actor: `ai-cli:${slug}`, now: clock.now }),
  };
}
export type OrdinaryFixture = Awaited<ReturnType<typeof createOrdinaryFixture>>;
export function invokeOrdinaryCli(fixture: OrdinaryFixture, args: string[], input: JsonValue) {
  return spawnSync(process.execPath, ['dist/cli.js', ...args], {
    env: { ...process.env, AI_TASKS_DB_PATH: fixture.path },
    encoding: 'utf8',
    input: JSON.stringify(input),
    timeout: 5000,
  });
}
export function ordinaryInput(
  fixture: OrdinaryFixture,
  payload: JsonValue,
  guards: {
    projectSlug?: string;
    revision?: number;
    operationId?: string;
    configRevision?: number;
    epoch?: string;
  } = {},
) {
  const project = z
    .optional(z.object({ config_revision: z.int().check(z.positive()) }))
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT config_revision FROM projects WHERE slug = ?')
        .get(guards.projectSlug ?? 'alpha'),
    );
  return mutationEnvelopeSchema.parse({
    operation_id: guards.operationId ?? randomUUID(),
    database_epoch: guards.epoch ?? fixture.epoch,
    ...(guards.revision === undefined ? {} : { expected_revision: guards.revision }),
    ...(project === undefined && guards.configRevision === undefined
      ? {}
      : { expected_config_revision: guards.configRevision ?? project?.config_revision }),
    payload,
  });
}
export function ordinarySnapshot(fixture: OrdinaryFixture) {
  return Object.fromEntries(
    [
      'application_state',
      'projects',
      'project_configs',
      'tasks',
      'project_emoji_reservations',
      'task_emoji_reservations',
      'audit_records',
      'operation_receipts',
    ].map((table) => [
      table,
      fixture.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}
export function customProjectConfig(priorityModel: JsonValue = { type: 'classic' }) {
  return {
    priority_model: priorityModel,
    ordinary_workflow: {
      initial_status_id: 'queued',
      statuses: [
        { id: 'queued', label: 'Очередь', category: 'not_started' },
        { id: 'doing', label: 'Работа', category: 'in_progress' },
        { id: 'finished', label: 'Готово', category: 'completed' },
      ],
      transitions: [
        { from: 'queued', to: 'doing', requires_confirmation: false },
        { from: 'doing', to: 'finished', requires_confirmation: true },
        { from: 'finished', to: 'doing', requires_confirmation: false },
      ],
    },
    recurring_workflow: {
      initial_status_id: 'draft',
      restore_status_id: 'paused',
      statuses: [
        { id: 'draft', label: 'Черновик', category: 'draft' },
        { id: 'active', label: 'Активно', category: 'active' },
        { id: 'paused', label: 'Пауза', category: 'paused' },
        { id: 'archived', label: 'Архив', category: 'archived' },
      ],
      transitions: [
        { from: 'draft', to: 'active', requires_confirmation: false },
        { from: 'active', to: 'paused', requires_confirmation: false },
        { from: 'paused', to: 'active', requires_confirmation: false },
        { from: 'draft', to: 'archived', requires_confirmation: false },
        { from: 'active', to: 'archived', requires_confirmation: false },
        { from: 'paused', to: 'archived', requires_confirmation: false },
        { from: 'archived', to: 'paused', requires_confirmation: false },
      ],
    },
  };
}
// Lazy imports keep the behavioral CLI assertion independently executable while the
// story core modules are pending T028/T029. Missing modules are never red evidence.
export async function ordinaryApi() {
  const [projects, tasks, transitions, projectQueries, taskQueries] = await Promise.all([
    import('../../src/core/projects/commands.js'),
    import('../../src/core/tasks/commands.js'),
    import('../../src/core/tasks/transitions.js'),
    import('../../src/core/queries/projects.js'),
    import('../../src/core/queries/tasks.js'),
  ]);
  return { ...projects, ...tasks, ...transitions, ...projectQueries, ...taskQueries };
}
/** Project-only checks can execute before the dependent task-command wave exists. */
export async function ordinaryProjectApi() {
  const [commands, queries, configuration] = await Promise.all([
    import('../../src/core/projects/commands.js'),
    import('../../src/core/queries/projects.js'),
    import('../../src/core/queries/configuration.js'),
  ]);
  return { ...commands, ...queries, ...configuration };
}
export const taskShape = z.object({
  id: z.uuid(),
  project_slug: z.string(),
  revision: z.number(),
  status_id: z.string(),
  category: z.string(),
  title: z.string(),
  description: z.string(),
});
export const projectShape = z.object({
  slug: z.string(),
  revision: z.number(),
  config_revision: z.number(),
});
export async function initialWork(fixture: OrdinaryFixture) {
  const api = await ordinaryApi();
  api.createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Альфа', emoji: '🔵' }),
  );
  api.createProject(
    fixture.human,
    'beta',
    ordinaryInput(fixture, { slug: 'beta', name: 'Бета', emoji: '🟢' }, { projectSlug: 'beta' }),
  );
  const result = api.createTask(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { kind: 'ordinary', title: 'Начальная задача', emoji: '🟣' }),
  );
  const beta = api.createTask(
    fixture.human,
    'beta',
    ordinaryInput(fixture, { kind: 'ordinary', title: 'Задача Беты' }, { projectSlug: 'beta' }),
  );
  return { api, task: taskShape.parse(result.data), betaTask: taskShape.parse(beta.data) };
}
export function durableCounts(fixture: OrdinaryFixture) {
  return {
    audit: fixture.connection.sqlite.prepare('SELECT count(*) FROM audit_records').pluck().get(),
    receipt: fixture.connection.sqlite
      .prepare('SELECT count(*) FROM operation_receipts')
      .pluck()
      .get(),
  };
}
export const mutationCases = [
  'project-update',
  'project-archive',
  'project-restore',
  'task-create',
  'task-update',
  'task-transition',
  'task-archive',
  'task-restore',
] as const;
export async function preparedMutation(
  fixture: OrdinaryFixture,
  kind: (typeof mutationCases)[number],
) {
  const { api, task } = await initialWork(fixture);
  let revision = 1;
  let payload: JsonValue = {};
  if (kind === 'task-restore') {
    api.archiveTask(fixture.human, 'alpha', task.id, ordinaryInput(fixture, {}, { revision: 1 }));
    revision = 2;
  }
  if (kind === 'project-restore') {
    api.archiveProject(
      fixture.human,
      'alpha',
      ordinaryInput(
        fixture,
        { affected_tasks: [{ task_id: task.id, expected_revision: 1 }] },
        { revision: 1 },
      ),
    );
    revision = 2;
  }
  if (kind === 'project-update') payload = { name: 'Новое имя', priority: 7 };
  if (kind === 'project-archive' || kind === 'project-restore')
    payload = { affected_tasks: [{ task_id: task.id, expected_revision: 1 }] };
  if (kind === 'task-create') payload = { kind: 'ordinary', title: 'Новая задача' };
  if (kind === 'task-update') payload = { description: 'Полная новая версия' };
  if (kind === 'task-transition') payload = { to_status_id: 'planning' };
  const input = ordinaryInput(fixture, payload, kind === 'task-create' ? {} : { revision });
  const invoke = (context: CoreContext, request: MutationEnvelope, slug = 'alpha') => {
    switch (kind) {
      case 'project-update':
        return api.updateProject(context, slug, request);
      case 'project-archive':
        return api.archiveProject(context, slug, request);
      case 'project-restore':
        return api.restoreProject(context, slug, request);
      case 'task-create':
        return api.createTask(context, slug, request);
      case 'task-update':
        return api.updateTask(context, slug, task.id, request);
      case 'task-transition':
        return api.transitionTask(context, slug, task.id, request);
      case 'task-archive':
        return api.archiveTask(context, slug, task.id, request);
      case 'task-restore':
        return api.restoreTask(context, slug, task.id, request);
    }
  };
  return { api, task, input, invoke };
}
const forwardStatuses = ['idea', 'planning', 'ready', 'in_progress', 'sanity_check', 'done'];
export async function taskAt(fixture: OrdinaryFixture, status: string) {
  const { api, task } = await initialWork(fixture);
  let current = task;
  for (const next of forwardStatuses.slice(1, forwardStatuses.indexOf(status) + 1)) {
    current = taskShape.parse(
      api.transitionTask(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(
          fixture,
          next === 'done'
            ? {
                to_status_id: next,
                confirmation: { asserted: true, user_text: 'Проверено пользователем' },
              }
            : { to_status_id: next },
          { revision: current.revision },
        ),
      ).data,
    );
  }
  return { api, task: current };
}
export const ordinaryPriorityModels: JsonValue[] = [
  { type: 'classic' },
  { type: 'eisenhower' },
  {
    type: 'named',
    levels: [
      { id: 'urgent', label: 'Срочно', color: 'red' },
      { id: 'later', label: 'Позже' },
    ],
  },
  { type: 'numeric', min: -2.5, max: 10.125, direction: 'higher' },
];
