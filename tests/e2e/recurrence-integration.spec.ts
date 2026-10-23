import { openTaskActions, closeTaskActions } from '../fixtures/task-ui.js';
import { expect, test, type Page } from '@playwright/test';
import { createProject } from '../../src/core/projects/commands.js';
import { migrateConfiguration } from '../../src/core/projects/configuration.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { errorEnvelopeSchema, mutationEnvelopeSchema } from '../../src/schema/envelopes.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import { ordinaryInput } from '../fixtures/ordinary-work.js';
import {
  recurrenceBrowserServer,
  seedBrowserRecurring,
  browserOccurrences,
  browserParent,
  browserWriteSnapshot,
  changeBrowserTimezone,
} from '../fixtures/recurrence-browser.js';

function mutationResponse(page: Page, path: string, method: string) {
  return page.waitForResponse(
    (reply) =>
      reply.request().method() === method && new URL(reply.url()).pathname === `/api/v1${path}`,
  );
}

async function failRecurrenceRefresh(page: Page, path: string) {
  const envelope = errorEnvelopeSchema.parse({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Не удалось загрузить повторение.',
      details: null,
      retryable: false,
    },
  });
  await page.evaluate(
    ({ target, body }) => {
      const original = globalThis.fetch.bind(globalThis);
      const state = { enabled: true };
      Reflect.set(globalThis, '__recurrenceRefreshFailure', state);
      globalThis.fetch = async (input, init) => {
        const address = input instanceof Request ? input.url : String(input);
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const response = await original(input, init);
        if (
          state.enabled &&
          method.toUpperCase() === 'GET' &&
          new URL(address, globalThis.location.href).pathname === target
        ) {
          return new Response(body, {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return response;
      };
    },
    { target: path, body: JSON.stringify(envelope) },
  );
}
async function restoreRecurrenceRefresh(page: Page) {
  await page.evaluate(() => {
    const state: unknown = Reflect.get(globalThis, '__recurrenceRefreshFailure');
    if (typeof state !== 'object' || state === null || !('enabled' in state))
      throw new Error('Missing recurrence refresh fault');
    Reflect.set(state, 'enabled', false);
  });
}

test('settings conflict review follows a newly selected attribution project and uses its current configuration guard', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    createProject(
      server.fixture.human,
      'beta',
      ordinaryInput(
        server.fixture,
        { slug: 'beta', name: 'Вторая атрибуция', emoji: '🌳' },
        { projectSlug: 'beta' },
      ),
    );
    const config = createDefaultProjectConfig();
    const status = config.ordinary_workflow.statuses[0];
    if (!status) throw new Error('Expected configured initial status');
    status.label = 'Начальная версия второго проекта';
    migrateConfiguration(
      server.fixture.human,
      'beta',
      ordinaryInput(
        server.fixture,
        jsonValueSchema.parse({
          config,
          status_mappings: [],
          priority_mappings: [],
          affected_tasks: [],
        }),
        { projectSlug: 'beta', revision: 1 },
      ),
    );
    await page.goto(`${server.origin}/settings?project_slug=alpha`);
    await page.getByLabel('Часовой пояс приложения', { exact: true }).fill('America/New_York');
    await changeBrowserTimezone(server);
    const conflict = mutationResponse(page, '/projects/alpha/application-settings', 'PATCH');
    await page.getByRole('button', { name: 'Сохранить часовой пояс', exact: true }).click();
    expect((await conflict).status()).toBe(409);
    const current = page.getByRole('region', { name: 'Текущая версия', exact: true });
    await expect(current).toContainText('alpha');
    await page.getByLabel('Проект для записи изменения', { exact: true }).selectOption('beta');
    await expect(page.getByLabel('Часовой пояс приложения', { exact: true })).toHaveValue(
      'America/New_York',
    );
    await expect(current).toContainText('beta');
    await expect(current).not.toContainText('alpha');
    const committed = mutationResponse(page, '/projects/beta/application-settings', 'PATCH');
    await page.getByRole('button', { name: 'Сохранить мой вариант ещё раз', exact: true }).click();
    const reply = await committed;
    expect(reply.status()).toBe(200);
    expect(mutationEnvelopeSchema.parse(reply.request().postDataJSON())).toMatchObject({
      expected_settings_revision: 2,
      expected_config_revision: 2,
      payload: { timezone: 'America/New_York' },
    });
    await expect(page.getByRole('status')).toContainText('Часовой пояс сохранён');
    expect(
      server.fixture.connection.sqlite
        .prepare(
          "SELECT count(*) FROM operation_receipts WHERE operation='settings.update' AND project_slug='beta'",
        )
        .pluck()
        .get(),
    ).toBe(1);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('a failed recurrence background refresh remains visible, retains the mounted dirty editor and blocks writes until explicit retry', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    const id = await seedBrowserRecurring(server, { active: true });
    const selected = browserOccurrences(server, id)[0];
    if (!selected) throw new Error('Expected real future occurrence');
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await openTaskActions(page);
    const occurrence = page.getByRole('article', {
      name: `Повторение ${selected.id}`,
      exact: true,
    });
    await occurrence.getByLabel(`Выбрать повторение ${selected.id}`, { exact: true }).check();
    await page.getByRole('button', { name: 'Изменить повторение', exact: true }).click();
    const window = page.getByLabel('Окно подтверждения, мс', { exact: true });
    await window.fill('123456');
    await closeTaskActions(page);
    await expect(page.getByLabel('Название задачи', { exact: true })).toBeVisible();
    await page
      .getByLabel('Название задачи', { exact: true })
      .fill('Проверка оборудования после правки');
    const recurrencePath = `/api/v1/projects/alpha/tasks/${id}/recurrence`;
    await failRecurrenceRefresh(page, recurrencePath);
    const updated = mutationResponse(page, `/projects/alpha/tasks/${id}`, 'PATCH');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect((await updated).status()).toBe(200);
    await openTaskActions(page);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Не удалось обновить повторение' }),
    ).toBeVisible();
    await expect(window).toHaveValue('123456');
    await expect(
      page.getByRole('button', { name: 'Сохранить повторение', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Обработать наступившие сроки', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Выполнить выбранные', exact: true }),
    ).toBeDisabled();
    const afterContent = browserWriteSnapshot(server);
    await restoreRecurrenceRefresh(page);
    const refreshed = page.waitForResponse(
      (reply) =>
        reply.request().method() === 'GET' && new URL(reply.url()).pathname === recurrencePath,
    );
    await page.getByRole('button', { name: 'Обновить повторение', exact: true }).click();
    expect((await refreshed).status()).toBe(200);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Не удалось обновить повторение' }),
    ).toHaveCount(0);
    await expect(window).toHaveValue('123456');
    await expect(
      occurrence.getByLabel(`Выбрать повторение ${selected.id}`, { exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole('button', { name: 'Сохранить повторение', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Выполнить выбранные', exact: true }),
    ).toBeEnabled();
    expect(browserWriteSnapshot(server)).toEqual(afterContent);
    expect(
      server.fixture.connection.sqlite
        .prepare("SELECT count(*) FROM operation_receipts WHERE operation='task.update'")
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      server.fixture.connection.sqlite
        .prepare(
          "SELECT count(*) FROM operation_receipts WHERE operation IN ('recurrence.configure','recurrence.tick','occurrence.complete','occurrence.cancel')",
        )
        .pluck()
        .get(),
    ).toBe(0);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('archiving active recurring work with debts and future pending records rejects atomically and keeps blockers reachable', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    const first = Date.now() - 2 * 86_400_000;
    const id = await seedBrowserRecurring(server, { first, active: true, activeSince: first });
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await openTaskActions(page);
    const tick = mutationResponse(page, '/projects/alpha/recurrence/tick', 'POST');
    await page.getByRole('button', { name: 'Обработать наступившие сроки', exact: true }).click();
    expect((await tick).status()).toBe(200);
    const archive = page.getByRole('button', { name: 'Архив', exact: true });
    await expect(archive).toBeEnabled();
    const rows = browserOccurrences(server, id);
    const debt = rows.find((item) => item.state === 'debt');
    const future = rows.find((item) => item.state === 'pending' && item.deadline > Date.now());
    if (!debt || !future)
      throw new Error('Expected actual historical debt and future pending obligation');
    const before = browserWriteSnapshot(server);
    const parent = browserParent(server.fixture, id);
    const rejected = mutationResponse(
      page,
      `/projects/alpha/tasks/${id}/recurrence/control`,
      'POST',
    );
    await archive.click();
    const reply = await rejected;
    expect(reply.status()).toBe(400);
    expect(await reply.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    await expect(page.getByRole('alert')).toBeVisible();
    expect(browserWriteSnapshot(server)).toEqual(before);
    expect(browserParent(server.fixture, id)).toEqual(parent);
    expect(parent.status_id).toBe('active');
    await openTaskActions(page);
    const blockers = page.getByRole('link', { name: /Ожидают:.*Долги:.*Открыть записи/u });
    await expect(blockers).toHaveAttribute('href', '#occurrences');
    await blockers.click();
    const article = page.getByRole('article', { name: `Повторение ${debt.id}`, exact: true });
    await expect(article.getByRole('heading', { name: 'Долг', exact: true })).toBeVisible();
    await expect(
      article.getByLabel(`Выбрать повторение ${debt.id}`, { exact: true }),
    ).toBeEnabled();
    await article.getByRole('button', { name: 'Сохранённая инструкция', exact: true }).click();
    await expect(
      article.getByRole('region', { name: 'Сохранённая инструкция', exact: true }),
    ).toContainText('Сохранённая');
    expect(browserOccurrences(server, id).find((item) => item.id === debt.id)).toEqual(debt);
    expect(browserOccurrences(server, id).find((item) => item.id === future.id)).toEqual(future);
    expect(browserWriteSnapshot(server)).toEqual(before);
  } finally {
    await page.context().close();
    await server.close();
  }
});
