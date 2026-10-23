import {
  installBrowserResponseLoss,
  waitForBrowserResponseLoss,
} from '../fixtures/browser-response-loss.js';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { eq } from 'drizzle-orm';
import { expect, test, type Page } from '@playwright/test';
import { createApp } from '../../src/api/app.js';
import { startDataHelper } from '../../src/api/helper-client.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { tasks } from '../../src/schema/entities.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import {
  mutationEnvelopeSchema,
  mutationSuccessEnvelopeSchema,
  errorEnvelopeSchema,
} from '../../src/schema/envelopes.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import type { JsonValue } from '../../src/schema/values.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createDatabaseFixture } from '../fixtures/database.js';
import { createTestClock } from '../fixtures/clock.js';

async function isolatedServer() {
  const fixture = await createDatabaseFixture(
    { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock },
    createTestClock(),
  );
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string')
    throw new Error('No dependency browser fixture port');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const host = `127.0.0.1:${address.port}`;
  const app = createApp({ helper: await startDataHelper({ databasePath: fixture.path }), host });
  try {
    await app.listen({ host: '127.0.0.1', port: address.port });
  } catch (error) {
    await app.close();
    await fixture.close();
    throw error;
  }
  return {
    fixture,
    origin: `http://${host}`,
    async close() {
      try {
        await app.close();
      } finally {
        await fixture.close();
      }
    },
  };
}
type Server = Awaited<ReturnType<typeof isolatedServer>>;
async function seedGraph(page: Page, server: Server, marker: string) {
  const meta = metaEnvelopeSchema.parse(
    await (await page.request.get(`${server.origin}/api/v1/meta?all_projects=true`)).json(),
  );
  const slug = `dependency-safe-${randomUUID().slice(0, 8)}`;
  async function mutate(options: {
    path: string;
    method?: 'POST' | 'PATCH';
    payload: JsonValue;
    revision?: number;
    newProject?: boolean;
  }) {
    const response = await page.request.fetch(`${server.origin}/api/v1${options.path}`, {
      method: options.method ?? 'POST',
      headers: {
        Origin: server.origin,
        'Content-Type': 'application/json',
        'X-AI-Tasks-Mutation': '1',
      },
      data: {
        operation_id: randomUUID(),
        database_epoch: meta.data.database_epoch,
        ...(options.newProject ? {} : { expected_config_revision: 1 }),
        ...(options.revision === undefined ? {} : { expected_revision: options.revision }),
        payload: options.payload,
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return mutationSuccessEnvelopeSchema.parse(await response.json());
  }
  await mutate({
    path: `/projects/${slug}`,
    newProject: true,
    payload: { slug, name: 'Безопасные зависимости', emoji: marker },
  });
  const parent = taskDetailSchema.parse(
    (
      await mutate({
        path: `/projects/${slug}/tasks`,
        payload: {
          kind: 'ordinary',
          title: 'Зависимая задача',
          description: 'Сохранённый **исходник**\n',
        },
      })
    ).data,
  );
  const prerequisite = taskDetailSchema.parse(
    (
      await mutate({
        path: `/projects/${slug}/tasks`,
        payload: {
          kind: 'ordinary',
          title: 'Предварительная задача',
          description: 'Не изменять предварительную задачу',
        },
      })
    ).data,
  );
  const payload = { prerequisite_task_id: prerequisite.id, prerequisite_project_slug: slug };
  const linked = taskDetailSchema.parse(
    (
      await mutate({
        path: `/projects/${slug}/tasks/${parent.id}/dependencies`,
        payload,
        revision: parent.revision,
      })
    ).data,
  );
  return {
    slug,
    parent: linked,
    prerequisite,
    payload,
    mutate,
    epoch: meta.data.database_epoch,
    endpoint: `/api/v1/projects/${slug}/tasks/${parent.id}/dependencies/remove`,
  };
}
function storedTask(server: Server, id: string) {
  const row = server.fixture.connection.db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!row) throw new Error('Missing seeded dependency task');
  return row;
}
function graphHistory(server: Server) {
  return {
    edges: server.fixture.connection.sqlite
      .prepare('SELECT * FROM task_dependencies ORDER BY dependent_task_id, prerequisite_task_id')
      .all(),
    audit: Number(
      server.fixture.connection.sqlite.prepare('SELECT count(*) FROM audit_records').pluck().get(),
    ),
    receipt: Number(
      server.fixture.connection.sqlite
        .prepare('SELECT count(*) FROM operation_receipts')
        .pluck()
        .get(),
    ),
  };
}
async function dirtyDescription(
  page: Page,
  server: Server,
  graph: Awaited<ReturnType<typeof seedGraph>>,
  text: string,
) {
  await page.goto(`${server.origin}/projects/${graph.slug}/tasks/${graph.parent.id}`);
  await expect(page.getByLabel('Название задачи', { exact: true })).toBeVisible();
  await page.getByLabel('Описание', { exact: true }).fill(text);
}
async function assertOriginalDirtyBase(
  page: Page,
  server: Server,
  graph: Awaited<ReturnType<typeof seedGraph>>,
  text: string,
) {
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(text);
  const attempted = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/projects/${graph.slug}/tasks/${graph.parent.id}`),
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const response = await attempted;
  expect(response.status()).toBe(409);
  expect(errorEnvelopeSchema.parse(await response.json()).error.code).toBe('REVISION_CONFLICT');
  const request = mutationEnvelopeSchema.parse(response.request().postDataJSON());
  expect(request).toMatchObject({
    database_epoch: graph.epoch,
    expected_revision: graph.parent.revision,
    expected_config_revision: 1,
    payload: { description: text },
  });
  expect(storedTask(server, graph.parent.id).description).toBe(graph.parent.description);
  await expect(page.getByRole('region', { name: 'Ваш вариант', exact: true })).toContainText(text);
}

test('stale nested dependency removal requires explicit retry while retaining dirty fields and their original base', async ({
  page,
}, info) => {
  const server = await isolatedServer();
  try {
    const graph = await seedGraph(page, server, info.project.name === 'webkit' ? '🧿' : '🔮');
    const dirty = '  Мой несохранённый **план**\n\nНе объединять автоматически.\n';
    await dirtyDescription(page, server, graph, dirty);
    await graph.mutate({
      path: `/projects/${graph.slug}/tasks/${graph.parent.id}`,
      method: 'PATCH',
      revision: graph.parent.revision,
      payload: { title: 'Название из другого клиента' },
    });
    const before = graphHistory(server);
    const parentBefore = storedTask(server, graph.parent.id);
    const targetBefore = storedTask(server, graph.prerequisite.id);
    const rejected = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith(graph.endpoint),
    );
    await page
      .getByRole('region', { name: 'Зависимости', exact: true })
      .getByRole('button', { name: 'Удалить зависимость', exact: true })
      .click();
    const failed = await rejected;
    expect(failed.status()).toBe(409);
    expect(errorEnvelopeSchema.parse(await failed.json()).error.code).toBe('REVISION_CONFLICT');
    const original = mutationEnvelopeSchema.parse(failed.request().postDataJSON());
    expect(original).toMatchObject({
      expected_revision: graph.parent.revision,
      expected_config_revision: 1,
      database_epoch: graph.epoch,
      payload: graph.payload,
    });
    expect(graphHistory(server)).toEqual(before);
    await expect(page.getByRole('region', { name: 'Текущая версия', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ваш вариант', exact: true })).toBeVisible();
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(dirty);
    const retried = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith(graph.endpoint),
    );
    await page.getByRole('button', { name: 'Сохранить мой вариант ещё раз', exact: true }).click();
    const response = await retried;
    expect(response.status()).toBe(200);
    const revised = mutationEnvelopeSchema.parse(response.request().postDataJSON());
    expect(revised.operation_id).not.toBe(original.operation_id);
    expect(revised).toMatchObject({
      expected_revision: parentBefore.revision,
      expected_config_revision: 1,
      database_epoch: graph.epoch,
      payload: original.payload,
    });
    expect(
      taskDetailSchema.parse(mutationSuccessEnvelopeSchema.parse(await response.json()).data),
    ).toMatchObject({
      dependencies: [],
      description: graph.parent.description,
      title: parentBefore.title,
      status_id: parentBefore.statusId,
    });
    expect(storedTask(server, graph.parent.id)).toEqual({
      ...parentBefore,
      revision: parentBefore.revision + 1,
      updatedAt: expect.any(Number),
    });
    expect(storedTask(server, graph.prerequisite.id)).toEqual(targetBefore);
    expect(graphHistory(server)).toEqual({
      edges: [],
      audit: before.audit + 1,
      receipt: before.receipt + 1,
    });
    await assertOriginalDirtyBase(page, server, graph, dirty);
    expect(graphHistory(server)).toEqual({
      edges: [],
      audit: before.audit + 1,
      receipt: before.receipt + 1,
    });
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('lost dependency removal response survives reload and replays exact body once without clearing dirty text', async ({
  page,
}, info) => {
  const server = await isolatedServer();
  try {
    const graph = await seedGraph(page, server, info.project.name === 'webkit' ? '🧿' : '🔮');
    const dirty = 'Черновик после потери ответа 👩🏽‍💻\n**Сохранить целиком**\n';
    await dirtyDescription(page, server, graph, dirty);
    const before = graphHistory(server);
    const parentBefore = storedTask(server, graph.parent.id);
    const targetBefore = storedTask(server, graph.prerequisite.id);
    const sent: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === graph.endpoint && request.method() === 'POST')
        sent.push(request.postData() ?? '');
    });
    await installBrowserResponseLoss(page, { method: 'POST', path: graph.endpoint });
    await page
      .getByRole('region', { name: 'Зависимости', exact: true })
      .getByRole('button', { name: 'Удалить зависимость', exact: true })
      .click();
    const lost = await waitForBrowserResponseLoss(page);
    expect(lost.status).toBe(200);
    const committed = mutationSuccessEnvelopeSchema.parse(JSON.parse(lost.body));
    const retry = page.getByRole('button', { name: 'Повторить ту же операцию', exact: true });
    await expect(retry).toBeVisible();
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(dirty);
    await expect(page.getByLabel('Описание', { exact: true })).toBeDisabled();
    expect(sent).toHaveLength(1);
    const original = mutationEnvelopeSchema.parse(JSON.parse(sent[0] ?? 'null'));
    expect(original).toMatchObject({
      expected_revision: graph.parent.revision,
      expected_config_revision: 1,
      database_epoch: graph.epoch,
      payload: graph.payload,
    });
    expect(graphHistory(server)).toEqual({
      edges: [],
      audit: before.audit + 1,
      receipt: before.receipt + 1,
    });
    await page.reload();
    await expect(retry).toBeVisible();
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(dirty);
    expect(sent).toHaveLength(1);
    const replay = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith(graph.endpoint),
    );
    await retry.click();
    const response = await replay;
    expect(response.status()).toBe(200);
    expect(mutationSuccessEnvelopeSchema.parse(await response.json())).toEqual(committed);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
    await expect(retry).toHaveCount(0);
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(dirty);
    expect(storedTask(server, graph.parent.id)).toEqual({
      ...parentBefore,
      revision: parentBefore.revision + 1,
      updatedAt: expect.any(Number),
    });
    expect(storedTask(server, graph.prerequisite.id)).toEqual(targetBefore);
    expect(graphHistory(server)).toEqual({
      edges: [],
      audit: before.audit + 1,
      receipt: before.receipt + 1,
    });
    await assertOriginalDirtyBase(page, server, graph, dirty);
    expect(graphHistory(server)).toEqual({
      edges: [],
      audit: before.audit + 1,
      receipt: before.receipt + 1,
    });
  } finally {
    await page.context().close();
    await server.close();
  }
});
