import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createApp } from '../../src/api/app.js';
import { startDataHelper } from '../../src/api/helper-client.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { mutationEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { projectLifecycleSchema, projectResourceSchema } from '../../src/schema/projects.js';
import { createDatabaseFixture } from '../fixtures/database.js';
import { createTestClock } from '../fixtures/clock.js';
import { insertStorageRow, taskRow, seedTime } from '../fixtures/storage-seed.js';

async function isolatedServer() {
  const fixture = await createDatabaseFixture(
    { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock },
    createTestClock(),
  );
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
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
function marker(info: TestInfo) {
  return info.project.name === 'webkit' ? '🪬' : '🔭';
}
async function createProject(page: Page, origin: string, info: TestInfo) {
  const metadata = metaEnvelopeSchema.parse(
    await (await page.request.get(`${origin}/api/v1/meta?all_projects=true`)).json(),
  );
  const slug = `safe-${randomUUID().slice(0, 8)}`;
  const response = await page.request.post(`${origin}/api/v1/projects/${slug}`, {
    headers: { Origin: origin, 'X-AI-Tasks-Mutation': '1' },
    data: {
      operation_id: randomUUID(),
      database_epoch: metadata.data.database_epoch,
      payload: { slug, name: 'Безопасный проект', emoji: marker(info) },
    },
  });
  expect(response.status()).toBe(201);
  return projectResourceSchema.parse(successEnvelopeSchema.parse(await response.json()).data);
}

test('explicit project lifecycle reconciliation uses the newly reviewed database epoch', async ({
  page,
}, info) => {
  const server = await isolatedServer();
  try {
    const project = await createProject(page, server.origin, info);
    await page.goto(`${server.origin}/projects/${project.slug}`);
    await page.getByRole('button', { name: 'Архивировать проект', exact: true }).click();
    const newEpoch = randomUUID();
    server.fixture.connection.sqlite
      .prepare('UPDATE application_state SET database_epoch=?')
      .run(newEpoch);
    await page.getByRole('button', { name: 'Подтвердить архивацию', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Текущая версия', exact: true })).toBeVisible();
    const retry = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/projects/${project.slug}/archive`),
    );
    await page.getByRole('button', { name: 'Сохранить мой вариант ещё раз', exact: true }).click();
    const response = await retry;
    expect(mutationEnvelopeSchema.parse(response.request().postDataJSON()).database_epoch).toBe(
      newEpoch,
    );
    expect(response.status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Восстановить', exact: true })).toBeEnabled();
    expect(
      server.fixture.connection.sqlite
        .prepare('SELECT archived_at FROM projects WHERE slug=?')
        .get(project.slug),
    ).toMatchObject({ archived_at: expect.any(Number) });
  } finally {
    await server.close();
  }
});

const failDraftDeletion = `
  const originalDelete = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (...args) {
    if (this.transaction.db.name === 'ai-tasks-browser-drafts' && sessionStorage.getItem('fail-project-draft-delete') !== 'no') {
      throw new DOMException('Injected draft cleanup failure', 'UnknownError');
    }
    return originalDelete.apply(this, args);
  };
`;

test('known project save keeps source and offers cleanup recovery without another mutation', async ({
  page,
}, info) => {
  const server = await isolatedServer();
  try {
    await page.addInitScript({ content: failDraftDeletion });
    await page.goto(`${server.origin}/projects`);
    await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
    const slug = `cleanup-${randomUUID().slice(0, 8)}`;
    const description = '  Сохранить исходник\n\n**Без переписывания**\n';
    await page.getByLabel('Название проекта', { exact: true }).fill('После сохранения');
    await page.getByLabel('Slug проекта', { exact: true }).fill(slug);
    await page.getByLabel('Эмодзи проекта', { exact: true }).fill(marker(info));
    await page.getByLabel('Описание проекта', { exact: true }).fill(description);
    let mutations = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith(`/projects/${slug}`))
        mutations += 1;
    });
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith(`/projects/${slug}`),
    );
    await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
    expect((await saved).status()).toBe(201);
    await expect(page.getByRole('alert')).toContainText(/проект сохранён.*черновик/iu);
    await expect(page.getByLabel('Описание проекта', { exact: true })).toHaveValue(description);
    await expect(
      page.getByRole('button', { name: 'Сохранить проект', exact: true }),
    ).toBeDisabled();
    await page.evaluate("sessionStorage.setItem('fail-project-draft-delete', 'no')");
    await page.getByRole('button', { name: 'Завершить сохранение', exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}/projects/${slug}`);
    expect(mutations).toBe(1);
    const response = await page.request.get(`${server.origin}/api/v1/projects/${slug}`);
    expect(
      projectResourceSchema.parse(successEnvelopeSchema.parse(await response.json()).data),
    ).toMatchObject({ description, revision: 1 });
  } finally {
    await server.close();
  }
});

test('project archive submits every child revision across pages without changing task snapshots', async ({
  page,
}, info) => {
  const server = await isolatedServer();
  try {
    const project = await createProject(page, server.origin, info);
    const expected = Array.from({ length: 201 }, (_, index) => ({
      task_id: randomUUID(),
      expected_revision: index === 200 ? 7 : 1,
    }));
    server.fixture.connection.sqlite.transaction(() => {
      expected.forEach((child, index) =>
        insertStorageRow(
          server.fixture.connection.sqlite,
          'tasks',
          taskRow({
            id: child.task_id,
            project_slug: project.slug,
            revision: child.expected_revision,
            title: `Задача ${index}`,
            status_id: index === 199 ? 'done' : 'idea',
            archived_at: index === 200 ? seedTime : null,
          }),
        ),
      );
    })();
    const before = server.fixture.connection.sqlite
      .prepare('SELECT * FROM tasks WHERE project_slug=? ORDER BY id')
      .all(project.slug);
    await page.goto(`${server.origin}/projects/${project.slug}`);
    const childPages: URL[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/v1/tasks') childPages.push(url);
    });
    await page.getByRole('button', { name: 'Архивировать проект', exact: true }).click();
    const archived = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/projects/${project.slug}/archive`),
    );
    await page.getByRole('button', { name: 'Подтвердить архивацию', exact: true }).click();
    const response = await archived;
    expect(response.status()).toBe(200);
    const payload = projectLifecycleSchema.parse(
      mutationEnvelopeSchema.parse(response.request().postDataJSON()).payload,
    );
    const byId = (left: { task_id: string }, right: { task_id: string }) =>
      left.task_id.localeCompare(right.task_id);
    expect(payload.affected_tasks.toSorted(byId)).toEqual(expected.toSorted(byId));
    expect(childPages).toHaveLength(2);
    for (const url of childPages) {
      expect(url.searchParams.get('project_slug')).toBe(project.slug);
      expect(url.searchParams.get('archive')).toBe('include');
      expect(url.searchParams.get('include_terminal')).toBe('true');
    }
    expect(childPages[1]?.searchParams.get('cursor')).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Восстановить', exact: true })).toBeEnabled();
    expect(
      server.fixture.connection.sqlite
        .prepare('SELECT * FROM tasks WHERE project_slug=? ORDER BY id')
        .all(project.slug),
    ).toEqual(before);
  } finally {
    await server.close();
  }
});
