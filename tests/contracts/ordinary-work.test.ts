import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { createApp } from '../../src/api/app.js';
import { createLazyDataHelper } from '../fixtures/lazy-data-helper.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { responseEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import type { JsonValue } from '../../src/schema/values.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createDatabaseFixture, type DatabaseFixture } from '../fixtures/database.js';
import { createTestClock } from '../fixtures/clock.js';
const cliEntry = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const host = '127.0.0.1:3000';
const projectSchema = z.object({
  slug: z.string(),
  revision: z.number(),
  config_revision: z.number(),
});
const taskSchema = z.object({
  id: z.uuid(),
  project_slug: z.string(),
  revision: z.number(),
  config_revision: z.number(),
  status_id: z.string(),
});
type Transport = 'http' | 'cli';
type JsonObject = Record<string, JsonValue>;
type Revision = {
  expected_revision?: number;
  expected_config_revision?: number;
};
let fixture: DatabaseFixture;
let app: ReturnType<typeof createApp>;
let epoch: string;
// Fixed valid fixture, independent of the future preset implementation under test.
function configuration(priority_model: JsonObject = { type: 'classic' }) {
  const ids = ['idea', 'planning', 'ready', 'in_progress', 'sanity_check', 'done', 'cancelled'];
  const categories = [
    'not_started',
    'not_started',
    'not_started',
    'in_progress',
    'review',
    'completed',
    'cancelled',
  ];
  const forward = ids.slice(0, 5).map((from, index) => ({
    from,
    to: ids[index + 1] ?? 'done',
    requires_confirmation: from === 'sanity_check',
  }));
  return {
    priority_model,
    ordinary_workflow: {
      initial_status_id: 'idea',
      statuses: ids.map((id, index) => ({
        id,
        label: id,
        category: categories[index] ?? 'not_started',
      })),
      transitions: [
        ...forward,
        ...forward.map(({ from, to }) => ({ from: to, to: from, requires_confirmation: false })),
        { from: 'done', to: 'in_progress', requires_confirmation: false },
        ...ids.slice(0, 5).map((from) => ({ from, to: 'cancelled', requires_confirmation: false })),
        { from: 'cancelled', to: 'idea', requires_confirmation: false },
      ],
    },
    recurring_workflow: {
      initial_status_id: 'draft',
      restore_status_id: 'paused',
      statuses: ['draft', 'active', 'paused', 'archived'].map((id) => ({
        id,
        label: id,
        category: id,
      })),
      transitions: (
        [
          ['draft', 'active'],
          ['draft', 'archived'],
          ['active', 'paused'],
          ['active', 'archived'],
          ['paused', 'active'],
          ['paused', 'archived'],
          ['archived', 'paused'],
        ] as const
      ).map(([from, to]) => ({ from, to, requires_confirmation: false })),
    },
  };
}
const operations = {
  projectCreate: { method: 'POST', cli: ['project', 'create'], suffix: '', mutation: true },
  projectGet: { method: 'GET', cli: ['project', 'get'], suffix: '', mutation: false },
  projectUpdate: { method: 'PATCH', cli: ['project', 'update'], suffix: '', mutation: true },
  projectArchive: {
    method: 'POST',
    cli: ['project', 'archive'],
    suffix: '/archive',
    mutation: true,
  },
  projectRestore: {
    method: 'POST',
    cli: ['project', 'restore'],
    suffix: '/restore',
    mutation: true,
  },
  taskCreate: { method: 'POST', cli: ['task', 'create'], suffix: '/tasks', mutation: true },
  taskGet: { method: 'GET', cli: ['task', 'get'], suffix: '/tasks', mutation: false },
  taskUpdate: { method: 'PATCH', cli: ['task', 'update'], suffix: '/tasks', mutation: true },
  transition: { method: 'POST', cli: ['task', 'transition'], suffix: '/tasks', mutation: true },
  archive: { method: 'POST', cli: ['task', 'archive'], suffix: '/tasks', mutation: true },
  restore: { method: 'POST', cli: ['task', 'restore'], suffix: '/tasks', mutation: true },
  config: { method: 'GET', cli: ['config', 'get'], suffix: '/config', mutation: false },
  preview: {
    method: 'POST',
    cli: ['description', 'preview'],
    suffix: '/description/preview',
    mutation: false,
  },
} as const;
async function request(
  transport: Transport,
  operation: keyof typeof operations,
  options: {
    slug?: string;
    id?: string;
    payload?: JsonObject;
    revisions?: Revision;
    operationId?: string;
  } = {},
) {
  const contract = operations[operation];
  const slug = options.slug ?? 'alpha';
  const payload = options.payload ?? {};
  const token = {
    operation_id: options.operationId ?? randomUUID(),
    database_epoch: epoch,
    ...options.revisions,
  };
  let url = `/api/v1/projects/${slug}${contract.suffix}`;
  if (options.id) url += `/${options.id}`;
  if (operation === 'transition') url += '/transitions';
  if (operation === 'archive' || operation === 'restore') url += `/${operation}`;
  if (transport === 'http') {
    const result = await app.inject({
      method: contract.method,
      url,
      headers: {
        host,
        origin: `http://${host}`,
        'content-type': 'application/json',
        'x-ai-tasks-mutation': '1',
      },
      ...(contract.method === 'GET'
        ? {}
        : { payload: contract.mutation ? { ...token, payload } : payload }),
    });
    return { status: result.statusCode, envelope: responseEnvelopeSchema.parse(result.json()) };
  }
  const args = [...contract.cli, ...(options.id ? [options.id] : []), '--project', slug, '--json'];
  const body = contract.mutation ? { ...payload, ...token } : payload;
  if (contract.method !== 'GET') args.push('--input', '-');
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    env: { ...process.env, AI_TASKS_DB_PATH: fixture.path },
    encoding: 'utf8',
    input: JSON.stringify(body),
    timeout: 5000,
  });
  if (result.error) throw result.error;
  expect(result.signal).toBeNull();
  const output = result.status === 0 ? result.stdout : result.stderr;
  expect(output.split('\n')).toHaveLength(2);
  expect(result.status === 0 ? result.stderr : result.stdout).toBe('');
  return { status: result.status ?? 1, envelope: responseEnvelopeSchema.parse(JSON.parse(output)) };
}
function success(result: Awaited<ReturnType<typeof request>>, transport: Transport, status = 200) {
  expect(result.status).toBe(transport === 'http' ? status : 0);
  return successEnvelopeSchema.parse(result.envelope);
}
function rejected(result: Awaited<ReturnType<typeof request>>, code: string, transport: Transport) {
  expect(result.status).not.toBe(transport === 'http' ? 200 : 0);
  expect(result.envelope).toMatchObject({ ok: false, error: { code } });
}
async function createProject(transport: Transport, extra: JsonObject = {}, slug = 'alpha') {
  return projectSchema.parse(
    success(
      await request(transport, 'projectCreate', {
        slug,
        payload: { slug, name: slug, emoji: slug === 'alpha' ? '🚀' : '🌲', ...extra },
      }),
      transport,
      201,
    ).data,
  );
}
async function createTask(transport: Transport, extra: JsonObject = {}) {
  return taskSchema.parse(
    success(
      await request(transport, 'taskCreate', {
        payload: { kind: 'ordinary', title: 'Проверить договор', ...extra },
        revisions: { expected_config_revision: 1 },
      }),
      transport,
      201,
    ).data,
  );
}
function snapshot() {
  return [
    'projects',
    'project_configs',
    'tasks',
    'project_emoji_reservations',
    'task_emoji_reservations',
    'audit_records',
    'operation_receipts',
    'application_state',
  ].map((table) => fixture.connection.sqlite.prepare(`SELECT * FROM ${table}`).all());
}
beforeEach(async () => {
  fixture = await createDatabaseFixture(
    { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock },
    createTestClock(),
  );
  epoch = z
    .object({ database_epoch: z.string() })
    .parse(
      fixture.connection.sqlite.prepare('SELECT database_epoch FROM application_state').get(),
    ).database_epoch;
  try {
    app = createApp({ helper: createLazyDataHelper({ databasePath: fixture.path }) });
    await app.ready();
  } catch (error) {
    await fixture.close();
    throw error;
  }
});
afterEach(async () => {
  try {
    await app?.close();
  } finally {
    await fixture?.close();
  }
});
describe.each(['http', 'cli'] as const)('%s ordinary-work transport', (transport) => {
  it('creates a project with default classic configuration and a durable attributed receipt', async () => {
    const project = await createProject(transport);
    expect(project).toMatchObject({ slug: 'alpha', revision: 1, config_revision: 1 });
    const config = success(await request(transport, 'config'), transport).data;
    expect(config).toMatchObject({
      revision: 1,
      priority_model: { type: 'classic' },
      ordinary_workflow: { initial_status_id: 'idea' },
    });
    const audits = fixture.connection.sqlite
      .prepare('SELECT actor,project_slug FROM audit_records')
      .all();
    expect(audits).toContainEqual({
      actor: transport === 'cli' ? 'ai-cli:alpha' : 'human-web',
      project_slug: 'alpha',
    });
    expect(
      fixture.connection.sqlite.prepare('SELECT count(*) AS count FROM operation_receipts').get(),
    ).toEqual({ count: 1 });
  });
  it.each([
    { type: 'classic' },
    { type: 'eisenhower' },
    { type: 'named', levels: [{ id: 'first', label: 'Первый', color: 'red' }] },
    { type: 'numeric', min: -10, max: 10, direction: 'lower' },
  ])('creates a project with supplied valid priority model %j', async (model) => {
    await createProject(transport, { config: configuration(model) });
    expect(success(await request(transport, 'config'), transport).data).toMatchObject({
      priority_model: model,
    });
  });
  it('rolls back invalid supplied configuration and unknown fields without reserving the project marker', async () => {
    const before = snapshot();
    const result = await request(transport, 'projectCreate', {
      payload: {
        slug: 'alpha',
        name: 'Alpha',
        emoji: '🚀',
        config: configuration({ type: 'numeric', min: 10, max: 0, direction: 'higher' }),
      },
    });
    rejected(result, 'VALIDATION_ERROR', transport);
    expect(snapshot()).toEqual(before);
    rejected(
      await request(transport, 'projectCreate', {
        payload: { slug: 'alpha', name: 'Alpha', emoji: '🚀', actor: 'human-web' },
      }),
      'VALIDATION_ERROR',
      transport,
    );
    expect(snapshot()).toEqual(before);
  });
  it('preserves exact Markdown and nullable priority/deadline through create/get/update', async () => {
    await createProject(transport);
    const description = '## План\n\n  Исходник 👩🏽‍💻\n\n- пункт\n';
    const task = await createTask(transport, {
      description,
      deadline: '2026-11-01T12:34:56.789+03:00',
      priority: { model: 'classic', level: 'high' },
    });
    expect(
      success(await request(transport, 'taskGet', { id: task.id }), transport).data,
    ).toMatchObject({ description, deadline: '2026-11-01T09:34:56.789Z', status_id: 'idea' });
    expect(
      success(
        await request(transport, 'taskUpdate', {
          id: task.id,
          revisions: { expected_revision: 1, expected_config_revision: 1 },
          payload: { description: `${description}\nХвост`, priority: null, deadline: null },
        }),
        transport,
      ).data,
    ).toMatchObject({
      description: `${description}\nХвост`,
      priority: null,
      deadline: null,
      revision: 2,
    });
  });
  it('replays the original create result/status and rejects changed same-ID payload atomically', async () => {
    await createProject(transport);
    const operationId = randomUUID();
    const options = {
      operationId,
      revisions: { expected_config_revision: 1 },
      payload: { kind: 'ordinary', title: 'Одна задача' },
    };
    const first = await request(transport, 'taskCreate', options);
    success(first, transport, 201);
    const before = snapshot();
    expect(await request(transport, 'taskCreate', options)).toEqual(first);
    rejected(
      await request(transport, 'taskCreate', {
        ...options,
        payload: { ...options.payload, title: 'Другой текст' },
      }),
      'IDEMPOTENCY_CONFLICT',
      transport,
    );
    expect(snapshot()).toEqual(before);
  });
});
describe.each(['http', 'cli'] as const)('%s guarded ordinary-work transport', (transport) => {
  it('rejects wrong-project ownership without audit or partial writes', async () => {
    await createProject(transport);
    await createProject(transport, {}, 'beta');
    const task = await createTask(transport);
    const before = snapshot();
    rejected(
      await request(transport, 'taskUpdate', {
        slug: 'beta',
        id: task.id,
        revisions: { expected_revision: 1, expected_config_revision: 1 },
        payload: { title: 'Нельзя' },
      }),
      'PROJECT_MISMATCH',
      transport,
    );
    expect(snapshot()).toEqual(before);
  });
  it.each(['revision', 'config', 'epoch'] as const)(
    'rejects stale %s tokens without any durable changes',
    async (token) => {
      await createProject(transport);
      const task = await createTask(transport);
      const before = snapshot();
      const current = epoch;
      try {
        if (token === 'epoch') epoch = randomUUID();
        rejected(
          await request(transport, 'taskUpdate', {
            id: task.id,
            revisions: {
              expected_revision: token === 'revision' ? 99 : 1,
              expected_config_revision: token === 'config' ? 99 : 1,
            },
            payload: { title: 'Нельзя' },
          }),
          token === 'epoch'
            ? 'DATABASE_EPOCH_CONFLICT'
            : token === 'revision'
              ? 'REVISION_CONFLICT'
              : 'CONFIG_CONFLICT',
          transport,
        );
      } finally {
        epoch = current;
      }
      expect(snapshot()).toEqual(before);
    },
  );
  it('requires transition-specific consent and records exact user text in immutable audit', async () => {
    await createProject(transport);
    const task = await createTask(transport);
    // Arrange a real persisted review-stage row; this test targets the adapter consent boundary.
    fixture.connection.sqlite
      .prepare("UPDATE tasks SET status_id='sanity_check' WHERE id=?")
      .run(task.id);
    const revisions = { expected_revision: 1, expected_config_revision: 1 };
    const before = snapshot();
    rejected(
      await request(transport, 'transition', {
        id: task.id,
        revisions,
        payload: { to_status_id: 'done' },
      }),
      'CONFIRMATION_REQUIRED',
      transport,
    );
    expect(snapshot()).toEqual(before);
    const text = ' Проверено лично: можно завершать. ';
    expect(
      success(
        await request(transport, 'transition', {
          id: task.id,
          revisions,
          payload: { to_status_id: 'done', confirmation: { asserted: true, user_text: text } },
        }),
        transport,
      ).data,
    ).toMatchObject({ status_id: 'done', category: 'completed', revision: 2 });
    const row = fixture.connection.sqlite
      .prepare('SELECT confirmation FROM audit_records ORDER BY rowid DESC LIMIT 1')
      .get();
    expect(z.object({ confirmation: z.string() }).parse(row).confirmation).toBe(
      JSON.stringify({ asserted: true, user_text: text }),
    );
  });
  it('archives/restores ordinary tasks preserving status and rejects edits while archived', async () => {
    await createProject(transport);
    const task = await createTask(transport);
    const archived = success(
      await request(transport, 'archive', {
        id: task.id,
        revisions: { expected_revision: 1, expected_config_revision: 1 },
      }),
      transport,
    );
    expect(archived.data).toMatchObject({
      status_id: 'idea',
      archived_at: expect.any(String),
      revision: 2,
    });
    const before = snapshot();
    const edit = await request(transport, 'taskUpdate', {
      id: task.id,
      revisions: { expected_revision: 2, expected_config_revision: 1 },
      payload: { title: 'Запрещённая правка' },
    });
    expect(edit.envelope.ok).toBe(false);
    expect(snapshot()).toEqual(before);
    expect(
      success(
        await request(transport, 'restore', {
          id: task.id,
          revisions: { expected_revision: 2, expected_config_revision: 1 },
        }),
        transport,
      ).data,
    ).toMatchObject({ archived_at: null, status_id: 'idea', revision: 3 });
  });
  it('updates project fields and reads its committed revision', async () => {
    await createProject(transport);
    const project = success(
      await request(transport, 'projectUpdate', {
        revisions: { expected_revision: 1, expected_config_revision: 1 },
        payload: { name: 'Новое имя', priority: -5 },
      }),
      transport,
    );
    expect(project.data).toMatchObject({ name: 'Новое имя', priority: -5, revision: 2 });
    expect(success(await request(transport, 'projectGet'), transport).data).toMatchObject({
      name: 'Новое имя',
      priority: -5,
      revision: 2,
    });
  });
  it('archives/restores the complete ordinary child revision set', async () => {
    await createProject(transport);
    const task = await createTask(transport);
    const payload = { affected_tasks: [{ task_id: task.id, expected_revision: 1 }] };
    success(
      await request(transport, 'projectArchive', {
        revisions: { expected_revision: 1, expected_config_revision: 1 },
        payload,
      }),
      transport,
    );
    success(
      await request(transport, 'projectRestore', {
        revisions: { expected_revision: 2, expected_config_revision: 1 },
        payload,
      }),
      transport,
    );
    expect(
      success(await request(transport, 'taskGet', { id: task.id }), transport).data,
    ).toMatchObject({ status_id: 'idea' });
  });
  it('keeps config and server-sanitized Markdown preview reads free of audit/receipt/state changes', async () => {
    await createProject(transport);
    const before = snapshot();
    success(await request(transport, 'config'), transport);
    const result = success(
      await request(transport, 'preview', {
        payload: {
          description: '**Текст** <script>alert(1)</script> [опасно](javascript:alert(1))',
        },
      }),
      transport,
    );
    const html = z.object({ rendered_html: z.string() }).parse(result.data).rendered_html;
    expect(html).toContain('<strong>Текст</strong>');
    expect(html).not.toMatch(/<script|href=["']javascript:/iu);
    expect(snapshot()).toEqual(before);
  });
});
it('publishes identical browser-safe presets through HTTP and compiled CLI without mutation', async () => {
  const before = snapshot();
  const response = await app.inject({
    url: '/api/v1/config/presets?all_projects=true',
    headers: { host },
  });
  expect(response.statusCode).toBe(200);
  const http = successEnvelopeSchema.parse(response.json());
  const cli = spawnSync(
    process.execPath,
    [cliEntry, 'config', 'presets', '--all-projects', '--json'],
    { env: { ...process.env, AI_TASKS_DB_PATH: fixture.path }, encoding: 'utf8', timeout: 5000 },
  );
  if (cli.error) throw cli.error;
  expect(cli.status).toBe(0);
  expect(cli.stderr).toBe('');
  expect(successEnvelopeSchema.parse(JSON.parse(cli.stdout)).data).toEqual(http.data);
  expect(snapshot()).toEqual(before);
});
it('reads the same committed ordinary task through CLI and HTTP with distinct fixed actor attribution', async () => {
  await createProject('http');
  const task = await createTask('cli', { description: 'Один общий исходник 🧪' });
  const before = snapshot();
  const http = success(await request('http', 'taskGet', { id: task.id }), 'http');
  const cli = success(await request('cli', 'taskGet', { id: task.id }), 'cli');
  expect(cli.data).toEqual(http.data);
  expect(snapshot()).toEqual(before);
  const actors = fixture.connection.sqlite
    .prepare('SELECT DISTINCT actor FROM audit_records ORDER BY actor')
    .all();
  expect(actors).toEqual([{ actor: 'ai-cli:alpha' }, { actor: 'human-web' }]);
  expect(
    fixture.connection.sqlite.prepare('SELECT count(*) AS count FROM operation_receipts').get(),
  ).toEqual({ count: 2 });
});
it.each(['http', 'cli'] as const)(
  'lists projects/tasks only with explicit read scope through %s without writes',
  async (transport) => {
    await createProject(transport);
    const task = await createTask(transport);
    const before = snapshot();
    for (const family of ['project', 'task']) {
      let envelope: unknown;
      if (transport === 'http') {
        const result = await app.inject({
          url: `/api/v1/${family === 'project' ? 'projects' : 'tasks'}?project_slug=alpha`,
          headers: { host },
        });
        expect(result.statusCode).toBe(200);
        envelope = result.json();
      } else {
        const result = spawnSync(
          process.execPath,
          [cliEntry, family, 'list', '--project', 'alpha', '--json'],
          {
            env: { ...process.env, AI_TASKS_DB_PATH: fixture.path },
            encoding: 'utf8',
            timeout: 5000,
          },
        );
        if (result.error) throw result.error;
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        envelope = JSON.parse(result.stdout);
      }
      const data = z
        .object({
          items: z.array(z.record(z.string(), z.json())),
          next_cursor: z.nullable(z.string()),
        })
        .parse(successEnvelopeSchema.parse(envelope).data);
      expect(data.items).toContainEqual(
        expect.objectContaining(family === 'project' ? { slug: 'alpha' } : { id: task.id }),
      );
    }
    expect(snapshot()).toEqual(before);
  },
);
