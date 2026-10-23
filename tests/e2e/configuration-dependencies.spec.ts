import { openTaskActions } from '../fixtures/task-ui.js';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { z } from 'zod/mini';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import type { PriorityModel } from '../../src/schema/configuration.js';
import {
  browserConfig,
  browserMutation,
  browserProject,
  browserSeedTask,
  browserTask,
  expectMobileForm,
} from '../fixtures/us2-browser.js';
const models: {
  model: PriorityModel;
  markers: [string, string];
}[] = [
  { model: { type: 'classic' }, markers: ['🍄', '🪻'] },
  { model: { type: 'eisenhower' }, markers: ['🐚', '🪸'] },
  {
    model: {
      type: 'named',
      levels: [
        { id: 'critical', label: 'Первая очередь', color: 'red' },
        { id: 'later', label: 'Позже', color: 'slate' },
      ],
    },
    markers: ['🍇', '🫐'],
  },
  { model: { type: 'numeric', min: -5, max: 10, direction: 'lower' }, markers: ['🍐', '🍋'] },
];
test('creates custom configuration with structured mobile controls and rejects invalid IDs atomically', async ({
  page,
}, info) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  const slug = `custom-${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Название проекта', { exact: true }).fill('Мой рабочий процесс');
  await page.getByLabel('Slug проекта', { exact: true }).fill(slug);
  await page
    .getByLabel('Эмодзи проекта', { exact: true })
    .fill(info.project.name === 'webkit' ? '🌺' : '🌸');
  await page.getByRole('button', { name: 'Настроить конфигурацию', exact: true }).click();
  const ordinary = page.getByRole('group', { name: 'Обычный рабочий процесс', exact: true });
  const ids = ordinary.getByLabel('Идентификатор статуса', { exact: true });
  const originalSecond = await ids.nth(1).inputValue();
  await ids.nth(1).fill(await ids.first().inputValue());
  await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/идентификатор|повтор|уникаль/iu);
  expect((await page.request.get(`/api/v1/projects/${slug}`)).status()).toBe(404);
  await ids.nth(1).fill(originalSecond);
  await ordinary.getByLabel('Название статуса', { exact: true }).first().fill('Входящие поручения');
  await ordinary.getByLabel('Цвет статуса', { exact: true }).first().selectOption('violet');
  await page.getByLabel('Начальный статус обычных задач', { exact: true }).selectOption('idea');
  await page.getByLabel('Статус восстановления', { exact: true }).selectOption('paused');
  const edge = ordinary.getByRole('group', { name: 'Переход idea → planning', exact: true });
  await edge.getByLabel('Требовать подтверждение', { exact: true }).check();
  await expectMobileForm(page);
  await expect(page.getByRole('textbox', { name: /JSON/iu })).toHaveCount(0);
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/v1/projects/${slug}`,
  );
  await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
  expect((await created).status()).toBe(201);
  const stored = z
    .object({
      data: z.object({
        ordinary_workflow: z.object({
          statuses: z.array(
            z.object({ id: z.string(), label: z.string(), color: z.optional(z.string()) }),
          ),
          transitions: z.array(
            z.object({ from: z.string(), to: z.string(), requires_confirmation: z.boolean() }),
          ),
        }),
      }),
    })
    .parse(await (await page.request.get(`/api/v1/projects/${slug}/config`)).json());
  expect(stored.data.ordinary_workflow.statuses).toContainEqual(
    expect.objectContaining({ id: 'idea', label: 'Входящие поручения', color: 'violet' }),
  );
  expect(stored.data.ordinary_workflow.transitions).toContainEqual({
    from: 'idea',
    to: 'planning',
    requires_confirmation: true,
  });
  const task = await browserSeedTask(page, slug);
  await page.goto(`/projects/${slug}/tasks/${task.id}`);
  await openTaskActions(page);
  await page.getByRole('button', { name: 'Планирование', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Подтвердите переход', exact: true });
  await expect(dialog).toContainText('Входящие поручения → Планирование');
  await dialog.getByLabel('Текст подтверждения').fill('Настроенное согласие пользователя');
  const transitioned = page.waitForResponse(
    (reply) => reply.url().endsWith('/transitions') && reply.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  expect((await transitioned).status()).toBe(200);
});
for (const { model, markers } of models) {
  test(`edits ${model.type} configuration and uses its nullable task priority in mobile forms`, async ({
    page,
  }, info) => {
    await page.goto('/projects');
    const config = await browserConfig(page);
    const slug = await browserProject(page, markers[info.project.name === 'webkit' ? 1 : 0], {
      ...config,
      priority_model: model,
    });
    await page.goto(`/projects/${slug}/configuration`);
    await expect(
      page.getByRole('heading', { name: 'Настройки проекта', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Модель приоритета', { exact: true })).toHaveValue(model.type);
    if (model.type === 'numeric') {
      await expect(page.getByLabel('Минимум', { exact: true })).toHaveValue('-5');
      await expect(page.getByLabel('Максимум', { exact: true })).toHaveValue('10');
      await expect(page.getByLabel('Направление', { exact: true })).toHaveValue('lower');
    }
    if (model.type === 'named')
      await expect(page.getByLabel('Название уровня', { exact: true }).first()).toHaveValue(
        'Первая очередь',
      );
    await expectMobileForm(page);
    await page
      .getByRole('group', { name: 'Обычный рабочий процесс', exact: true })
      .getByLabel('Название статуса', { exact: true })
      .first()
      .fill(`Входящие ${model.type}`);
    const preview = page.waitForResponse(
      (reply) => reply.url().endsWith('/config/preview') && reply.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Предпросмотр изменений', exact: true }).click();
    expect((await preview).status()).toBe(200);
    const committed = page.waitForResponse(
      (reply) => reply.url().endsWith('/config/migrate') && reply.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
    expect((await committed).status()).toBe(200);
    await page.goto(`/projects/${slug}/tasks/new`);
    await page.getByLabel('Название задачи', { exact: true }).fill(`Приоритет ${model.type}`);
    if (model.type === 'classic')
      await page.getByLabel('Приоритет', { exact: true }).selectOption('high');
    if (model.type === 'named')
      await page.getByLabel('Приоритет', { exact: true }).selectOption('critical');
    if (model.type === 'numeric')
      await page.getByLabel('Приоритет', { exact: true }).fill('-1.875');
    if (model.type === 'eisenhower') {
      await page.getByLabel('Указать приоритет', { exact: true }).check();
      await page.getByLabel('Важно', { exact: true }).check();
      await page.getByLabel('Срочно', { exact: true }).uncheck();
    }
    await expectMobileForm(page);
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/projects/${slug}/tasks`,
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const data = z
      .object({ id: z.uuid(), priority: z.unknown() })
      .parse(successEnvelopeSchema.parse(await response.json()).data);
    const expected =
      model.type === 'classic'
        ? { model: 'classic', level: 'high' }
        : model.type === 'named'
          ? { model: 'named', level_id: 'critical' }
          : model.type === 'numeric'
            ? { model: 'numeric', value: -1.875 }
            : { model: 'eisenhower', important: true, urgent: false };
    expect(data.priority).toEqual(expected);
    await expect(page).toHaveURL(new RegExp(`/projects/${slug}/tasks/${data.id}$`, 'u'));
    await expect(page.getByLabel('Название задачи', { exact: true })).toBeVisible();
    if (model.type === 'numeric') await page.getByLabel('Приоритет', { exact: true }).fill('');
    else if (model.type === 'eisenhower')
      await page.getByLabel('Указать приоритет', { exact: true }).uncheck();
    else await page.getByLabel('Приоритет', { exact: true }).selectOption('');
    const cleared = page.waitForResponse(
      (reply) => reply.request().method() === 'PATCH' && reply.url().endsWith(`/tasks/${data.id}`),
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect(successEnvelopeSchema.parse(await (await cleared).json()).data).toMatchObject({
      priority: null,
    });
  });
}
test('previews exact migration mappings including archived members and explicitly commits one revision set', async ({
  page,
}, info) => {
  await page.goto('/projects');
  const slug = await browserProject(page, info.project.name === 'webkit' ? '🔬' : '🔭');
  const active = await browserSeedTask(page, slug, {
    priority: { model: 'classic', level: 'high' },
  });
  const archived = await browserSeedTask(page, slug);
  await browserMutation(page, `/projects/${slug}/tasks/${archived.id}/archive`, {
    revision: 1,
    configRevision: 1,
    payload: {},
  });
  await page.goto(`/projects/${slug}/configuration`);
  await page.getByLabel('Модель приоритета', { exact: true }).selectOption('named');
  await page.getByLabel('Идентификатор уровня', { exact: true }).first().fill('first');
  await page.getByLabel('Название уровня', { exact: true }).first().fill('Сначала');
  const ordinary = page.getByRole('group', { name: 'Обычный рабочий процесс', exact: true });
  await ordinary.getByLabel('Идентификатор статуса', { exact: true }).first().fill('inbox');
  await page.getByLabel('Начальный статус обычных задач', { exact: true }).selectOption('inbox');
  const preview = page.waitForResponse(
    (response) =>
      response.url().endsWith('/config/preview') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Предпросмотр изменений', exact: true }).click();
  expect((await preview).status()).toBe(200);
  const mappings = page.getByRole('region', { name: 'Обязательные соответствия', exact: true });
  await expect(mappings).toContainText('idea');
  await mappings.getByLabel('Новый статус для idea', { exact: true }).selectOption('inbox');
  await mappings.getByLabel('Новый приоритет для high', { exact: true }).selectOption('first');
  const affected = page.getByRole('region', { name: 'Затронутые задачи', exact: true });
  await expect(affected).toContainText(active.id);
  await expect(affected).toContainText(archived.id);
  await expect(affected).toContainText(/архив/iu);
  const migrated = page.waitForResponse(
    (response) =>
      response.url().endsWith('/config/migrate') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
  const result = await migrated;
  expect(result.status()).toBe(200);
  const posted = z
    .object({
      payload: z.object({
        affected_tasks: z.array(z.object({ task_id: z.string(), expected_revision: z.number() })),
        status_mappings: z.array(
          z.object({ kind: z.string(), from_status_id: z.string(), to_status_id: z.string() }),
        ),
      }),
    })
    .parse(result.request().postDataJSON());
  expect(posted.payload.affected_tasks).toEqual(
    expect.arrayContaining([
      { task_id: active.id, expected_revision: 1 },
      { task_id: archived.id, expected_revision: 2 },
    ]),
  );
  expect(posted.payload.status_mappings).toContainEqual({
    kind: 'ordinary',
    from_status_id: 'idea',
    to_status_id: 'inbox',
  });
  for (const id of [active.id, archived.id]) {
    const task = browserTask.parse(
      successEnvelopeSchema.parse(
        await (await page.request.get(`/api/v1/projects/${slug}/tasks/${id}`)).json(),
      ).data,
    );
    expect(task.status_id).toBe('inbox');
    expect(task.description).toBe('Точный **исходник**\n');
  }
});
test('searches and selects a cross-project prerequisite, blocks completion, and removes only the link', async ({
  page,
}, info) => {
  await page.goto('/projects');
  const source = await browserProject(page, info.project.name === 'webkit' ? '🪵' : '🌳');
  const target = await browserProject(page, info.project.name === 'webkit' ? '🎍' : '🍁');
  const parent = await browserSeedTask(page, source);
  const prerequisite = await browserSeedTask(page, target, {
    title: 'Найти договор в другом проекте',
  });
  await page.goto(`/projects/${source}/tasks/${parent.id}`);
  await openTaskActions(page);
  await page.getByRole('button', { name: 'Добавить зависимость', exact: true }).click();
  await page.getByLabel('Проект предварительной задачи', { exact: true }).selectOption(target);
  await page.getByLabel('Поиск задачи', { exact: true }).fill('Найти договор');
  await page
    .getByRole('button', { name: 'Выбрать: Найти договор в другом проекте', exact: true })
    .click();
  const added = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/tasks/${parent.id}/dependencies`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Добавить выбранную задачу', exact: true }).click();
  const response = await added;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({
    payload: { prerequisite_task_id: prerequisite.id, prerequisite_project_slug: target },
  });
  await openTaskActions(page);
  const links = page.getByRole('region', { name: 'Зависимости', exact: true });
  await expect(links).toContainText('Найти договор');
  await expect(links).toContainText(/не завершена|блокирует/iu);
  await openTaskActions(page);
  await page.getByRole('button', { name: 'Планирование', exact: true }).click();
  await openTaskActions(page);
  await expect(page.getByRole('button', { name: 'Готово к работе', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Готово к работе', exact: true }).click();
  await openTaskActions(page);
  await expect(page.getByRole('button', { name: 'В работе', exact: true })).toBeDisabled();
  const blocked = browserTask.parse(
    successEnvelopeSchema.parse(
      await (await page.request.get(`/api/v1/projects/${source}/tasks/${parent.id}`)).json(),
    ).data,
  );
  expect(blocked.status_id).toBe('ready');
  const removed = page.waitForResponse(
    (reply) => reply.url().endsWith('/dependencies/remove') && reply.request().method() === 'POST',
  );
  await links.getByRole('button', { name: 'Удалить зависимость', exact: true }).click();
  expect((await removed).status()).toBe(200);
  await openTaskActions(page);
  await expect(links.getByText('Найти договор')).toHaveCount(0);
  expect(
    successEnvelopeSchema.parse(
      await (await page.request.get(`/api/v1/projects/${source}/tasks/${parent.id}`)).json(),
    ).data,
  ).toMatchObject({
    status_id: blocked.status_id,
    dependencies: [],
    description: parent.description,
  });
});
test('retains proposed configuration on a real stale commit and requires explicit current/proposed retry', async ({
  page,
}, info) => {
  await page.goto('/projects');
  const config = await browserConfig(page);
  const slug = await browserProject(page, info.project.name === 'webkit' ? '🦦' : '🐿️');
  await page.goto(`/projects/${slug}/configuration`);
  const labels = page
    .getByRole('group', { name: 'Обычный рабочий процесс', exact: true })
    .getByLabel('Название статуса', { exact: true });
  await labels.first().fill('Мой сохранённый черновик конфигурации');
  const external = {
    ...config,
    ordinary_workflow: {
      ...config.ordinary_workflow,
      statuses: config.ordinary_workflow.statuses.map((status) => ({
        ...status,
        label: `Внешняя версия ${status.label}`,
      })),
    },
  };
  await browserMutation(page, `/projects/${slug}/config/migrate`, {
    revision: 1,
    configRevision: 1,
    payload: { config: external, status_mappings: [], priority_mappings: [], affected_tasks: [] },
  });
  await page.getByRole('button', { name: 'Предпросмотр изменений', exact: true }).click();
  const stale = page.waitForResponse(
    (reply) => reply.url().endsWith('/config/migrate') && reply.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
  expect((await stale).status()).toBe(409);
  await expect(labels.first()).toHaveValue('Мой сохранённый черновик конфигурации');
  await expect(page.getByRole('region', { name: 'Текущая версия' })).toContainText(
    'Внешняя версия',
  );
  await expect(page.getByRole('region', { name: 'Ваш вариант' })).toContainText(
    'Мой сохранённый черновик конфигурации',
  );
  const retry = page.waitForResponse(
    (reply) => reply.url().endsWith('/config/migrate') && reply.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Сохранить мой вариант ещё раз', exact: true }).click();
  expect((await retry).status()).toBe(200);
  const saved = z
    .object({
      data: z.object({
        revision: z.number(),
        ordinary_workflow: z.object({ statuses: z.array(z.object({ label: z.string() })) }),
      }),
    })
    .parse(await (await page.request.get(`/api/v1/projects/${slug}/config`)).json());
  expect(saved.data.revision).toBe(3);
  expect(saved.data.ordinary_workflow.statuses[0]?.label).toBe(
    'Мой сохранённый черновик конфигурации',
  );
});
test('rejects a marker claim after valid preview while leaving saved configuration and both tasks unchanged', async ({
  page,
}, info) => {
  await page.goto('/projects');
  const presets = await browserConfig(page);
  const config = {
    ...presets,
    ordinary_workflow: {
      initial_status_id: 'todo',
      statuses: [
        { id: 'todo', label: 'Ожидает', category: 'not_started' },
        { id: 'done', label: 'Одобрено', category: 'completed' },
      ],
      transitions: [{ from: 'todo', to: 'done', requires_confirmation: true }],
    },
  };
  const slug = await browserProject(page, info.project.name === 'webkit' ? '🦚' : '🦜', config);
  const completed = await browserSeedTask(page, slug, { emoji: '🧪' });
  await browserMutation(page, `/projects/${slug}/tasks/${completed.id}/transitions`, {
    revision: 1,
    configRevision: 1,
    payload: {
      to_status_id: 'done',
      confirmation: { asserted: true, user_text: 'Работа проверена' },
    },
  });
  await page.goto(`/projects/${slug}/configuration`);
  const row = page.getByRole('group', { name: 'Статус done', exact: true });
  await row.getByLabel('Категория', { exact: true }).selectOption('not_started');
  await page.getByRole('button', { name: 'Предпросмотр изменений', exact: true }).click();
  const mappings = page.getByRole('region', { name: 'Обязательные соответствия', exact: true });
  const apply = page.getByRole('button', { name: 'Применить изменения', exact: true });
  await expect(apply).toBeDisabled();
  await mappings.getByLabel('Новый статус для done', { exact: true }).selectOption('done');
  const validPreview = page.waitForResponse(
    (reply) => reply.url().endsWith('/config/preview') && reply.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Предпросмотр изменений', exact: true }).click();
  const previewResponse = await validPreview;
  expect(previewResponse.status()).toBe(200);
  expect(successEnvelopeSchema.parse(await previewResponse.json()).data).toMatchObject({
    issues: [],
    affected_tasks: [{ task_id: completed.id, expected_revision: 2 }],
  });
  await expect(apply).toBeEnabled();
  // Preview reserves nothing: a real concurrent writer can claim the now-free marker.
  const active = await browserSeedTask(page, slug, { emoji: '🧪' });
  const committed = page.waitForResponse(
    (reply) => reply.url().endsWith('/config/migrate') && reply.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
  expect((await committed).status()).toBe(409);
  await expect(page.getByRole('alert')).toContainText(/эмодзи.*занят|маркер.*занят/iu);
  await expect(row.getByLabel('Категория', { exact: true })).toHaveValue('not_started');
  const saved = z
    .object({ data: z.object({ revision: z.number() }) })
    .parse(await (await page.request.get(`/api/v1/projects/${slug}/config`)).json());
  expect(saved.data.revision).toBe(1);
  for (const [task, status, revision] of [
    [completed, 'done', 2],
    [active, 'todo', 1],
  ] as const) {
    const savedTask = browserTask.parse(
      successEnvelopeSchema.parse(
        await (await page.request.get(`/api/v1/projects/${slug}/tasks/${task.id}`)).json(),
      ).data,
    );
    expect(savedTask).toMatchObject({
      status_id: status,
      revision,
      emoji: '🧪',
      description: task.description,
    });
  }
});
