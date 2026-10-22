import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { z } from 'zod/mini';
import { createApp } from '../../src/api/app.js';
import { startDataHelper } from '../../src/api/helper-client.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createDatabaseFixture } from '../fixtures/database.js';
import { createTestClock } from '../fixtures/clock.js';
const projectSchema = z.object({
  slug: z.string(),
  revision: z.number(),
  config_revision: z.number(),
});
const taskSchema = z.object({ id: z.uuid(), revision: z.number(), config_revision: z.number() });
const projectMarkers = [
  '🚀',
  '🌲',
  '🌊',
  '🌙',
  '☀️',
  '⭐',
  '🪐',
  '🌻',
  '🍀',
  '🌈',
  '🦊',
  '🐬',
  '🐳',
  '🐼',
  '🦉',
  '🐢',
  '🦋',
  '🐝',
  '🐞',
  '🐙',
];
function marker(info: TestInfo, index: number): string {
  return projectMarkers[index + (info.project.name === 'webkit' ? 10 : 0)] ?? '🦄';
}
async function api(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: { Origin: origin, 'X-AI-Tasks-Mutation': '1', 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true);
  return successEnvelopeSchema.parse(await response.json());
}
async function mutation(
  page: Page,
  method: 'POST' | 'PATCH',
  path: string,
  input: {
    payload: unknown;
    revisions?: Record<string, number>;
  },
) {
  const meta = metaEnvelopeSchema.parse(
    await (
      await page.request.get(`${new URL(page.url()).origin}/api/v1/meta?all_projects=true`)
    ).json(),
  );
  return api(page, method, path, {
    operation_id: randomUUID(),
    database_epoch: meta.data.database_epoch,
    ...input.revisions,
    payload: input.payload,
  });
}
async function seedProject(page: Page, info: TestInfo, index: number) {
  const slug = `browser-${randomUUID().slice(0, 8)}`;
  return projectSchema.parse(
    (
      await mutation(page, 'POST', `/projects/${slug}`, {
        payload: { slug, name: `Проект ${slug}`, emoji: marker(info, index) },
      })
    ).data,
  );
}
async function seedTask(page: Page, slug: string, extra = {}) {
  return taskSchema.parse(
    (
      await mutation(page, 'POST', `/projects/${slug}/tasks`, {
        payload: { kind: 'ordinary', title: 'Проверить договор', ...extra },
        revisions: { expected_config_revision: 1 },
      })
    ).data,
  );
}
async function checkForm(page: Page) {
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const root = await page.locator('#root').boundingBox();
    const form = await page.getByRole('form').boundingBox();
    if (!root || !form) throw new Error('A labeled editor form must be visible');
    expect(root.width).toBeLessThanOrEqual(430);
    expect(root.x).toBeCloseTo((width - root.width) / 2, 0);
    expect(form.x).toBeGreaterThanOrEqual(root.x);
    expect(form.x + form.width).toBeLessThanOrEqual(root.x + root.width);
    for (const control of await page
      .getByRole('form')
      .locator('button,input,select,textarea')
      .all()) {
      const bounds = await control.boundingBox();
      if (bounds) expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
  }
}
test('project chooser offers actual creation and built-in priority/workflow preset selection', async ({
  page,
}, info) => {
  await page.goto('/projects');
  const create = page.getByRole('button', { name: 'Создать проект', exact: true });
  await expect(create).toBeVisible();
  await create.click();
  await page.getByLabel('Название проекта', { exact: true }).fill('Личные дела');
  await page
    .getByLabel(/slug|идентификатор проекта/iu)
    .fill(`personal-${randomUUID().slice(0, 8)}`);
  await page.getByLabel('Эмодзи проекта', { exact: true }).fill(marker(info, 0));
  const priority = page.getByLabel('Модель приоритета', { exact: true });
  await priority.selectOption('eisenhower');
  await expect(priority).toHaveValue('eisenhower');
  await expect(page.getByLabel('Обычный рабочий процесс', { exact: true })).toBeVisible();
  await checkForm(page);
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/v1\/projects\/[^/]+$/u.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
  const result = await created;
  expect(result.status()).toBe(201);
  const project = projectSchema.parse(successEnvelopeSchema.parse(await result.json()).data);
  const config = await api(page, 'GET', `/projects/${project.slug}/config`);
  expect(config.data).toMatchObject({ priority_model: { type: 'eisenhower' } });
});
test('keeps the selected conflicting task emoji and all draft text for correction', async ({
  page,
}, info) => {
  await page.goto('/');
  const project = await seedProject(page, info, 1);
  await seedTask(page, project.slug, { emoji: '🧪' });
  await page.goto(`/projects/${project.slug}/tasks/new`);
  await page.getByLabel('Название задачи', { exact: true }).fill('Моя новая задача');
  await page.getByLabel('Описание', { exact: true }).fill('Несохранённый **план**');
  await page.getByLabel('Эмодзи задачи', { exact: true }).fill('🧪');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/эмодзи.*занят|друг.*эмодзи/iu);
  await expect(page.getByLabel('Эмодзи задачи', { exact: true })).toHaveValue('🧪');
  await expect(page.getByLabel('Название задачи', { exact: true })).toHaveValue('Моя новая задача');
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue('Несохранённый **план**');
  await page.getByLabel('Эмодзи задачи', { exact: true }).fill('🎯');
  await checkForm(page);
});
test('preserves exact Markdown source, shows server preview, copies semantic emoji and stores precise local deadline', async ({
  page,
}, info) => {
  await page.goto('/');
  const project = await seedProject(page, info, 2);
  await page.goto(`/projects/${project.slug}/tasks/new`);
  const source = '## План\n\n  Сохранить пробелы 👩🏽‍💻\n\n- пункт\n';
  await page.getByLabel('Название задачи', { exact: true }).fill('Срок и описание');
  await page.getByLabel('Описание', { exact: true }).fill(source);
  await page.getByLabel('Эмодзи задачи', { exact: true }).fill('👩🏽‍💻');
  await page.getByLabel('Дата срока', { exact: true }).fill('2026-11-01');
  await page.getByLabel('Время срока', { exact: true }).fill('12:34:56.789');
  await expect(page.getByText('Europe/Moscow', { exact: true })).toBeVisible();
  const preview = page.waitForResponse((response) =>
    response.url().endsWith(`/projects/${project.slug}/description/preview`),
  );
  await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  expect((await preview).status()).toBe(200);
  await expect(page.getByRole('region', { name: 'Предпросмотр описания' })).toContainText(
    'Сохранить пробелы',
  );
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(source);
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/projects/${project.slug}/tasks`),
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const result = successEnvelopeSchema.parse(await (await created).json());
  expect(result.data).toMatchObject({
    description: source,
    deadline: '2026-11-01T09:34:56.789Z',
    emoji: '👩🏽‍💻',
  });
  await page.getByRole('button', { name: 'Скопировать эмодзи', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/эмодзи.*скопирован/iu);
});
test('names the task and exact transition in consent and records actual confirmation text', async ({
  page,
}, info) => {
  await page.goto('/');
  const project = await seedProject(page, info, 3);
  const task = await seedTask(page, project.slug);
  let revision = 1;
  for (const status of ['planning', 'ready', 'in_progress', 'sanity_check']) {
    await mutation(page, 'POST', `/projects/${project.slug}/tasks/${task.id}/transitions`, {
      payload: { to_status_id: status },
      revisions: { expected_revision: revision++, expected_config_revision: 1 },
    });
  }
  await page.goto(`/projects/${project.slug}/tasks/${task.id}`);
  await page.getByRole('button', { name: /завершить|выполнено/iu }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Проверить договор');
  await expect(dialog).toContainText(/провер|sanity_check/iu);
  await expect(dialog).toContainText(/заверш|done|выполнено/iu);
  const text = 'Проверил договор лично, всё готово.';
  await dialog.getByLabel('Текст подтверждения', { exact: true }).fill(text);
  const response = page.waitForResponse(
    (result) => result.request().method() === 'POST' && result.url().endsWith('/transitions'),
  );
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const requestBody: unknown = (await response).request().postDataJSON();
  expect(requestBody).toMatchObject({
    payload: { to_status_id: 'done', confirmation: { asserted: true, user_text: text } },
  });
});
test('retains a stale proposal beside current server text and requires an explicit new save', async ({
  page,
}, info) => {
  await page.goto('/');
  const project = await seedProject(page, info, 4);
  const task = await seedTask(page, project.slug, { description: 'Первый исходник' });
  await page.goto(`/projects/${project.slug}/tasks/${task.id}`);
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Описание', { exact: true }).fill('Мой несохранённый вариант');
  await mutation(page, 'PATCH', `/projects/${project.slug}/tasks/${task.id}`, {
    payload: { description: 'Версия другого клиента' },
    revisions: { expected_revision: 1, expected_config_revision: 1 },
  });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/измен|конфликт/iu);
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
    'Мой несохранённый вариант',
  );
  await expect(page.getByRole('region', { name: 'Текущая версия' })).toContainText(
    'Версия другого клиента',
  );
  await expect(page.getByRole('region', { name: 'Ваш вариант' })).toContainText(
    'Мой несохранённый вариант',
  );
  await expect(
    page.getByRole('button', { name: /сохранить.*ещё|повторить.*сохранение/iu }),
  ).toBeVisible();
});
test('keeps archived project/task views read-only and restores ordinary status without hidden transition', async ({
  page,
}, info) => {
  await page.goto('/');
  const project = await seedProject(page, info, 5);
  const task = await seedTask(page, project.slug);
  await mutation(page, 'POST', `/projects/${project.slug}/tasks/${task.id}/archive`, {
    payload: {},
    revisions: { expected_revision: 1, expected_config_revision: 1 },
  });
  await page.goto(`/projects/${project.slug}/tasks/${task.id}`);
  await expect(page.getByText(/^В архиве\. Редактирование недоступно/iu)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toBeDisabled();
  const [restoreResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/projects/${project.slug}/tasks/${task.id}/restore`),
    ),
    page.getByRole('button', { name: 'Восстановить', exact: true }).click(),
  ]);
  expect(restoreResponse.status()).toBe(200);
  const restored = await api(page, 'GET', `/projects/${project.slug}/tasks/${task.id}`);
  expect(restored.data).toMatchObject({ archived_at: null, status_id: 'idea' });
  await mutation(page, 'POST', `/projects/${project.slug}/archive`, {
    payload: { affected_tasks: [{ task_id: task.id, expected_revision: 3 }] },
    revisions: { expected_revision: 1, expected_config_revision: 1 },
  });
  await page.goto(`/projects/${project.slug}`);
  await expect(page.getByText(/проект.*архив/iu)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать задачу', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Восстановить', exact: true })).toBeEnabled();
});
test('retains proposed fields when editing an existing task to an occupied marker', async ({
  page,
}, info) => {
  await page.goto('/');
  const project = await seedProject(page, info, 7);
  await seedTask(page, project.slug, { emoji: '🧪' });
  const edited = await seedTask(page, project.slug, { emoji: '🎯', description: 'База' });
  await page.goto(`/projects/${project.slug}/tasks/${edited.id}`);
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Эмодзи задачи', { exact: true }).fill('🧪');
  await page.getByLabel('Описание', { exact: true }).fill('Правка должна остаться');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/эмодзи.*занят|друг.*эмодзи/iu);
  await expect(page.getByLabel('Эмодзи задачи', { exact: true })).toHaveValue('🧪');
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue('Правка должна остаться');
  expect(
    (await api(page, 'GET', `/projects/${project.slug}/tasks/${edited.id}`)).data,
  ).toMatchObject({ emoji: '🎯', description: 'База', revision: 1 });
});
async function zonedServer() {
  const fixture = await createDatabaseFixture(
    { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock },
    createTestClock(),
  );
  // Real fixture setup changes the application zone, avoiding dependencies on US4 settings UI.
  fixture.connection.sqlite.prepare("UPDATE application_state SET timezone='Europe/Berlin'").run();
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
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
test('rejects DST gaps and requires an explicit offset branch for a repeated local time', async ({
  page,
}, info) => {
  const server = await zonedServer();
  try {
    await page.goto(`${server.origin}/`);
    const project = await seedProject(page, info, 6);
    await page.goto(`${server.origin}/projects/${project.slug}/tasks/new`);
    await page.getByLabel('Название задачи', { exact: true }).fill('Проверка местного времени');
    await page.getByLabel('Дата срока', { exact: true }).fill('2026-03-29');
    await page.getByLabel('Время срока', { exact: true }).fill('02:30:00.000');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/не существует|перевод.*час/iu);
    await page.getByLabel('Дата срока', { exact: true }).fill('2026-10-25');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByLabel('Смещение UTC', { exact: true })).toBeVisible();
    await page.getByLabel('Смещение UTC', { exact: true }).selectOption('+01:00');
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/projects/${project.slug}/tasks`),
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect(successEnvelopeSchema.parse(await (await saved).json()).data).toMatchObject({
      deadline: '2026-10-25T01:30:00.000Z',
    });
  } finally {
    await page.close();
    await server.close();
  }
});
