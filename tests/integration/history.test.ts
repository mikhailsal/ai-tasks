import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/mini';
import { createApp } from '../../src/api/app.js';
import { startDataHelper } from '../../src/api/helper-client.js';
import { createProject } from '../../src/core/projects/commands.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';
import { updateProject } from '../../src/core/projects/commands.js';
import {
  historyApi,
  historySnapshot,
  seedHistoryPages,
  historicalConsent,
  seedAbsentProjectHistory,
  createHistoryTask,
} from '../fixtures/history.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  invokeOrdinaryCli,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture;
let app: ReturnType<typeof createApp> | undefined;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Альфа', emoji: '🚀' }),
  );
});
it('paginates immutable audit history by descending timestamp then UUID and preserves one as_of', async () => {
  const listAudit = await historyApi();
  seedHistoryPages(fixture);
  const before = historySnapshot(fixture);
  const expected = z
    .array(z.object({ id: z.string() }))
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT id FROM audit_records ORDER BY timestamp DESC,id DESC')
        .all(),
    )
    .map((row) => row.id);
  const first = listAudit(fixture.human, { project_slug: 'alpha' });
  expect(first.data.items).toHaveLength(50);
  expect(first.data.next_cursor).not.toBeNull();
  expect(first.meta.as_of).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  fixture.clock.advanceBy(20000);
  const second = listAudit(fixture.human, {
    project_slug: 'alpha',
    cursor: first.data.next_cursor,
  });
  expect(second.meta.as_of).toBe(first.meta.as_of);
  expect(second.meta.now).not.toBe(first.meta.now);
  expect(second.data.next_cursor).toBeNull();
  expect([...first.data.items, ...second.data.items].map((row) => row.id)).toEqual(expected);
  expect(
    listAudit(fixture.human, { all_projects: true, limit: 200 }).data.items.map((row) => row.id),
  ).toEqual(expected);
  expect(historySnapshot(fixture)).toEqual(before);
});
it('filters project, entity and operation together without conflating same-time events or actors', async () => {
  const listAudit = await historyApi();
  const task = createHistoryTask(fixture);
  const operation = updateProject(
    fixture.agent('alpha'),
    'alpha',
    ordinaryInput(fixture, { name: 'Название от CLI' }, { revision: 1 }),
  );
  createProject(
    fixture.human,
    'beta',
    ordinaryInput(fixture, { slug: 'beta', name: 'Бета', emoji: '🌲' }, { projectSlug: 'beta' }),
  );
  const before = historySnapshot(fixture);
  const scoped = listAudit(fixture.human, { project_slug: 'alpha', entity_id: task.id });
  expect(scoped.data.items.length).toBeGreaterThan(0);
  expect(
    scoped.data.items.every((row) => row.project_slug === 'alpha' && row.entity_id === task.id),
  ).toBe(true);
  expect(listAudit(fixture.human, { project_slug: 'beta', entity_id: task.id }).data.items).toEqual(
    [],
  );
  const receipt = listAudit(fixture.human, {
    all_projects: true,
    operation_id: operation.meta.operation_id,
  });
  expect(receipt.data.items.map((row) => row.id)).toEqual(operation.meta.audit_ids);
  expect(receipt.data.items[0]).toMatchObject({
    actor: 'ai-cli:alpha',
    origin: 'cli',
    action: 'project.update',
  });
  expect(
    listAudit(fixture.human, {
      project_slug: 'alpha',
      entity_id: task.id,
      operation_id: operation.meta.operation_id,
    }).data.items,
  ).toEqual([]);
  expect(historySnapshot(fixture)).toEqual(before);
});
it('returns original before/after values, config meanings and exact user consent after later configuration edits', async () => {
  const listAudit = await historyApi();
  const {
    task,
    completed,
    confirmation,
    previous,
    config,
    descriptionUpdate,
    oldSource,
    newSource,
  } = historicalConsent(fixture);
  const before = historySnapshot(fixture);
  const history = listAudit(fixture.human, {
    project_slug: 'alpha',
    entity_id: task.id,
    operation_id: completed.meta.operation_id,
  });
  expect(history.data.items).toHaveLength(1);
  expect(history.data.items[0]).toMatchObject({
    config_revision: 1,
    config_snapshot: { revision: 1, ...previous },
    confirmation,
    actor: 'human-web',
    origin: 'web',
    database_epoch: fixture.epoch,
    changes: expect.arrayContaining([
      { field: 'status_id', before: 'sanity_check', after: 'done' },
      { field: 'category', before: 'review', after: 'completed' },
    ]),
  });
  expect(history.data.items[0]?.config_snapshot).not.toEqual({ revision: 2, ...config });
  const descriptionHistory = listAudit(fixture.human, {
    project_slug: 'alpha',
    entity_id: task.id,
    operation_id: descriptionUpdate.meta.operation_id,
  });
  expect(descriptionHistory.data.items[0]).toMatchObject({
    actor: 'ai-cli:alpha',
    origin: 'cli',
    config_revision: 1,
    changes: expect.arrayContaining([
      { field: 'description', before: oldSource, after: newSource },
    ]),
  });
  expect(historySnapshot(fixture)).toEqual(before);
});
it('reads restored historical scope/entity even when neither has a live row, including its old epoch', async () => {
  const listAudit = await historyApi();
  const historical = seedAbsentProjectHistory(fixture);
  const before = historySnapshot(fixture);
  expect(
    fixture.connection.sqlite
      .prepare("SELECT count(*) FROM projects WHERE slug='former-project'")
      .pluck()
      .get(),
  ).toBe(0);
  const page = listAudit(fixture.human, {
    project_slug: 'former-project',
    entity_id: historical.entityId,
    operation_id: historical.operationId,
  });
  expect(page.data.items).toHaveLength(1);
  expect(page.data.items[0]).toMatchObject({
    id: historical.id,
    config_revision: 7,
    config_snapshot: historical.snapshot,
    changes: historical.changes,
    confirmation: null,
    database_epoch: historical.epoch,
  });
  expect(historySnapshot(fixture)).toEqual(before);
});
it.each([
  {},
  { all_projects: true, project_slug: 'alpha' },
  { project_slug: '' },
  { all_projects: true, limit: 0 },
  { all_projects: true, limit: 201 },
  { all_projects: true, entity_id: 'not-uuid' },
  { all_projects: true, operation_id: 'not-uuid' },
  { all_projects: true, now: 0 },
  { all_projects: true, as_of: '2026-10-21T00:00:00Z' },
])('rejects invalid audit scope/filter input %j without writes', async (input) => {
  const listAudit = await historyApi();
  const before = historySnapshot(fixture);
  expect(() => listAudit(fixture.human, input)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(historySnapshot(fixture)).toEqual(before);
});
it('does not invent a current config revision for a historical snapshotless event', async () => {
  const listAudit = await historyApi();
  const historical = seedAbsentProjectHistory(fixture, null);
  const before = historySnapshot(fixture);
  expect(
    listAudit(fixture.human, { all_projects: true, operation_id: historical.operationId }).data
      .items,
  ).toEqual([
    expect.objectContaining({ id: historical.id, config_snapshot: null, config_revision: null }),
  ]);
  expect(historySnapshot(fixture)).toEqual(before);
});
const validHeaders = {
  host: '127.0.0.1:3000',
  origin: 'http://127.0.0.1:3000',
  'content-type': 'application/json',
  'x-ai-tasks-mutation': '1',
};
it.each([
  { host: 'attacker.invalid' },
  { origin: 'https://attacker.invalid' },
  { origin: '' },
  { 'sec-fetch-site': 'cross-site' },
  { 'content-type': 'text/plain' },
  { 'x-ai-tasks-mutation': '' },
])('rejects browser boundary %j before any project/audit/receipt write', async (headers) => {
  app = createApp({ helper: await startDataHelper({ databasePath: fixture.path }) });
  const before = historySnapshot(fixture);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/beta',
    headers: { ...validHeaders, ...headers },
    payload: {
      operation_id: randomUUID(),
      database_epoch: fixture.epoch,
      payload: { slug: 'beta', name: 'Нельзя создать', emoji: '🌲' },
    },
  });
  expect(response.statusCode).toBe(403);
  expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('ORIGIN_REJECTED');
  expect(historySnapshot(fixture)).toEqual(before);
});
it('rejects an actual raw JSON body over 1MiB before writes and leaks no submitted source', async () => {
  app = createApp({ helper: await startDataHelper({ databasePath: fixture.path }) });
  const before = historySnapshot(fixture);
  const secret = 'PRIVATE-BODY-DO-NOT-LOG';
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/beta',
    headers: validHeaders,
    payload: JSON.stringify({
      operation_id: randomUUID(),
      database_epoch: fixture.epoch,
      payload: { slug: 'beta', name: secret, emoji: '🌲', description: secret.repeat(60000) },
    }),
  });
  expect(response.statusCode).toBe(400);
  expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
  expect(response.body).not.toContain(secret);
  expect(historySnapshot(fixture)).toEqual(before);
});
it('scrubs unexpected SQLite diagnostics and keeps failed mutation state/history atomic', async () => {
  app = createApp({ helper: await startDataHelper({ databasePath: fixture.path }) });
  const secret = 'PRIVATE_SQL /home/private/secret.sqlite token=never-output';
  fixture.connection.sqlite.exec(
    `CREATE TRIGGER fail_history BEFORE INSERT ON audit_records BEGIN SELECT RAISE(ABORT,'${secret}'); END`,
  );
  const before = historySnapshot(fixture);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/alpha/tasks',
    headers: validHeaders,
    payload: {
      operation_id: randomUUID(),
      database_epoch: fixture.epoch,
      expected_config_revision: 1,
      payload: { kind: 'ordinary', title: 'Данные не должны частично сохраниться' },
    },
  });
  expect(response.statusCode).toBe(500);
  expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('INTERNAL_ERROR');
  for (const forbidden of [secret, 'fail_history', 'INSERT INTO', 'stack', '/home/private'])
    expect(response.body).not.toContain(forbidden);
  const cli = invokeOrdinaryCli(
    fixture,
    ['task', 'create', '--project', 'alpha', '--json', '--input', '-'],
    {
      operation_id: randomUUID(),
      database_epoch: fixture.epoch,
      expected_config_revision: 1,
      kind: 'ordinary',
      title: 'Ошибка CLI тоже не раскрывает внутреннюю диагностику',
    },
  );
  expect(cli.status).toBe(1);
  expect(cli.stdout).toBe('');
  expect(errorEnvelopeSchema.parse(JSON.parse(cli.stderr)).error.code).toBe('INTERNAL_ERROR');
  for (const forbidden of [secret, 'fail_history', 'INSERT INTO', 'stack', '/home/private'])
    expect(cli.stderr).not.toContain(forbidden);
  expect(historySnapshot(fixture)).toEqual(before);
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
});
it('real HTTP aggregate audit route reads persisted history [US3 behavioral red]', async () => {
  app = createApp({ helper: await startDataHelper({ databasePath: fixture.path }) });
  const headers = { host: '127.0.0.1:3000' };
  const meta = await app.inject({ method: 'GET', url: '/api/v1/meta?all_projects=true', headers });
  expect(meta.statusCode).toBe(200);
  expect(metaEnvelopeSchema.parse(meta.json()).data.database_epoch).toBe(fixture.epoch);
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/audit?all_projects=true',
    headers,
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({
    ok: true,
    data: { items: expect.any(Array), next_cursor: null },
  });
});
