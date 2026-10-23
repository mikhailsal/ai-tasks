import { openTaskActions } from '../fixtures/task-ui.js';
import {
  installBrowserResponseLoss,
  waitForBrowserResponseLoss,
} from '../fixtures/browser-response-loss.js';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod/mini';
import { archiveProject, createProject } from '../../src/core/projects/commands.js';
import {
  mutationEnvelopeSchema,
  mutationSuccessEnvelopeSchema,
} from '../../src/schema/envelopes.js';
import { ordinaryInput } from '../fixtures/ordinary-work.js';
import {
  recurrenceBrowserServer,
  seedBrowserRecurring,
  browserOccurrences,
  browserWriteSnapshot,
  changeBrowserTimezone,
  type RecurrenceBrowserServer,
} from '../fixtures/recurrence-browser.js';
function row(page: Page, id: string) {
  return page.getByRole('article', { name: `Повторение ${id}`, exact: true });
}
function response(page: Page, path: string, method = 'POST') {
  return page.waitForResponse(
    (reply) =>
      reply.request().method() === method && new URL(reply.url()).pathname === `/api/v1${path}`,
  );
}
async function tick(page: Page) {
  const pending = response(page, '/projects/alpha/recurrence/tick');
  await page.getByRole('button', { name: 'Обработать наступившие сроки', exact: true }).click();
  expect((await pending).status()).toBe(200);
}
async function actualFields(page: Page, id: string, instant: number) {
  const fields = row(page, id).getByRole('group', {
    name: `Фактическое выполнение ${id}`,
    exact: true,
  });
  const local = new Date(instant + 3 * 3600000).toISOString();
  await fields.getByLabel('Дата выполнения', { exact: true }).fill(local.slice(0, 10));
  await fields.getByLabel('Время выполнения', { exact: true }).fill(local.slice(11, 23));
  return { fields, date: local.slice(0, 10), time: local.slice(11, 23) };
}
async function storedDraft(page: Page, taskId: string) {
  const key = `occurrences:alpha:${taskId}`;
  const value: unknown = await page.evaluate(`new Promise((resolve, reject) => {
    const opened = indexedDB.open('ai-tasks-browser-drafts');
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result;
      const transaction = db.transaction('draft-records', 'readonly');
      const request = transaction.objectStore('draft-records').get(${JSON.stringify(key)});
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  })`);
  return z
    .nullable(
      z.object({
        base: z.object({ expected_settings_revision: z.number() }),
        fields: z.object({
          timezone: z.string(),
          selected: z.array(z.object({ id: z.string(), date: z.string(), time: z.string() })),
        }),
      }),
    )
    .parse(value);
}
function currentGeneration(server: RecurrenceBrowserServer, id: string) {
  return z
    .object({ current_generation_id: z.string() })
    .parse(
      server.fixture.connection.sqlite
        .prepare('SELECT * FROM recurrence_state WHERE task_id=?')
        .get(id),
    ).current_generation_id;
}
function completeAuditCount(server: RecurrenceBrowserServer, id: string) {
  return z
    .number()
    .parse(
      server.fixture.connection.sqlite
        .prepare(
          "SELECT count(*) FROM audit_records WHERE entity_id=? AND action='occurrence.complete'",
        )
        .pluck()
        .get(id),
    );
}
test('settings UI attributes a global timezone change to an archived project and preserves saved instants and elapsed generations', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    const calendar = await seedBrowserRecurring(server, { active: true });
    const elapsed = await seedBrowserRecurring(server, { active: true, mode: 'after_completion' });
    createProject(
      server.fixture.human,
      'archive',
      ordinaryInput(
        server.fixture,
        { slug: 'archive', name: 'Архивная атрибуция', emoji: '🌳' },
        { projectSlug: 'archive' },
      ),
    );
    archiveProject(
      server.fixture.human,
      'archive',
      ordinaryInput(
        server.fixture,
        { affected_tasks: [] },
        { projectSlug: 'archive', revision: 1 },
      ),
    );
    const calendarBefore = currentGeneration(server, calendar);
    const elapsedBefore = server.fixture.connection.sqlite
      .prepare('SELECT * FROM schedule_generations WHERE task_id=? ORDER BY generation_number')
      .all(elapsed);
    const stored = server.fixture.connection.sqlite
      .prepare('SELECT * FROM occurrences ORDER BY id')
      .all();
    const originalIds = z
      .array(z.object({ id: z.string() }))
      .parse(stored)
      .map((item) => item.id);
    await page.goto(`${server.origin}/settings?project_slug=archive`);
    await expect(
      page.getByRole('heading', { name: 'Настройки приложения', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Проект для записи изменения', { exact: true }).selectOption('archive');
    await expect(
      page.getByRole('option', { name: /Архивная атрибуция.*В архиве/u }),
    ).toBeAttached();
    await page.getByLabel('Часовой пояс приложения', { exact: true }).fill('America/New_York');
    const pending = response(page, '/projects/archive/application-settings', 'PATCH');
    await page.getByRole('button', { name: 'Сохранить часовой пояс', exact: true }).click();
    const reply = await pending;
    expect(reply.status()).toBe(200);
    const result = mutationSuccessEnvelopeSchema.parse(await reply.json());
    expect(mutationEnvelopeSchema.parse(reply.request().postDataJSON())).toMatchObject({
      database_epoch: server.fixture.epoch,
      expected_settings_revision: 1,
      expected_config_revision: 1,
      payload: { timezone: 'America/New_York' },
    });
    await expect(page.getByRole('status')).toContainText('Часовой пояс сохранён');
    expect(currentGeneration(server, calendar)).not.toBe(calendarBefore);
    expect(
      server.fixture.connection.sqlite
        .prepare('SELECT * FROM schedule_generations WHERE task_id=? ORDER BY generation_number')
        .all(elapsed),
    ).toEqual(elapsedBefore);
    const after = server.fixture.connection.sqlite
      .prepare('SELECT * FROM occurrences ORDER BY id')
      .all();
    const originalRows = after.filter((item) =>
      originalIds.includes(z.object({ id: z.string() }).parse(item).id),
    );
    expect(originalRows).toEqual(stored);
    const audit = z
      .object({ project_slug: z.string(), actor: z.string(), changes: z.string() })
      .parse(
        server.fixture.connection.sqlite
          .prepare("SELECT * FROM audit_records WHERE operation_id=? AND entity_type='settings'")
          .get(result.meta.operation_id),
      );
    expect(audit).toMatchObject({ project_slug: 'archive', actor: 'human-web' });
    expect(JSON.parse(audit.changes)).toContainEqual({
      field: 'timezone',
      before: 'Europe/Moscow',
      after: 'America/New_York',
    });
    await page.reload();
    await expect(page.getByLabel('Часовой пояс приложения', { exact: true })).toHaveValue(
      'America/New_York',
    );
  } finally {
    await page.context().close();
    await server.close();
  }
});
test('lost completion response is retried with the identical persisted operation after reload and commits one selected outcome', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    const first = Date.now() - 2 * 86400000;
    const id = await seedBrowserRecurring(server, { first, active: true, activeSince: first });
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await openTaskActions(page);
    await tick(page);
    const debts = browserOccurrences(server, id).filter((item) => item.state === 'debt');
    const selected = debts[0];
    const untouched = debts[1];
    if (!selected || !untouched) throw new Error('Expected two real debts');
    await row(page, selected.id)
      .getByLabel(`Выбрать повторение ${selected.id}`, { exact: true })
      .check();
    await actualFields(page, selected.id, selected.deadline + 60000);
    const path = `/api/v1/projects/alpha/tasks/${id}/occurrences/complete`;
    const requests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === path && request.method() === 'POST')
        requests.push(request.postData() ?? '');
    });
    await installBrowserResponseLoss(page, { method: 'POST', path });
    await page.getByRole('button', { name: 'Выполнить выбранные', exact: true }).click();
    const lost = await waitForBrowserResponseLoss(page);
    expect(lost.status).toBe(200);
    const delivered = mutationSuccessEnvelopeSchema.parse(JSON.parse(lost.body));
    await expect(
      page.getByRole('button', { name: 'Повторить ту же операцию', exact: true }),
    ).toBeEnabled();
    expect(requests).toHaveLength(1);
    expect(completeAuditCount(server, selected.id)).toBe(1);
    const committed = browserWriteSnapshot(server);
    await page.reload();
    await openTaskActions(page);
    await expect(
      page.getByRole('button', { name: 'Выполнить выбранные', exact: true }),
    ).toBeDisabled();
    const retried = response(page, path.slice('/api/v1'.length));
    await page.getByRole('button', { name: 'Повторить ту же операцию', exact: true }).click();
    const replayed = await retried;
    expect(replayed.status()).toBe(200);
    expect(mutationSuccessEnvelopeSchema.parse(await replayed.json())).toEqual(delivered);
    await expect(
      page.getByRole('button', { name: 'Повторить ту же операцию', exact: true }),
    ).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    const original = mutationEnvelopeSchema.parse(JSON.parse(requests[0] ?? ''));
    expect(browserWriteSnapshot(server)).toEqual(committed);
    expect(completeAuditCount(server, selected.id)).toBe(1);
    expect(
      server.fixture.connection.sqlite
        .prepare('SELECT count(*) FROM operation_receipts WHERE operation_id=?')
        .pluck()
        .get(original.operation_id),
    ).toBe(1);
    expect(browserOccurrences(server, id).find((item) => item.id === untouched.id)).toEqual(
      untouched,
    );
    expect(browserOccurrences(server, id).find((item) => item.id === selected.id)).toMatchObject({
      state: 'completed_late',
      actual_completed_at: selected.deadline + 60000,
    });
  } finally {
    await page.context().close();
    await server.close();
  }
});
test('actual-time draft retains its original timezone through settings conflict and reload before explicit reconciliation', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    const id = await seedBrowserRecurring(server, { first: Date.now() - 86400000, active: true });
    const selected = browserOccurrences(server, id)[0];
    if (!selected) throw new Error('Expected materialized pending occurrence');
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await openTaskActions(page);
    await row(page, selected.id)
      .getByLabel(`Выбрать повторение ${selected.id}`, { exact: true })
      .check();
    const actual = selected.deadline + 60000;
    const entered = await actualFields(page, selected.id, actual);
    await expect
      .poll(async () => (await storedDraft(page, id))?.fields.selected[0]?.time)
      .toBe(entered.time);
    await changeBrowserTimezone(server);
    const currentSelected = browserOccurrences(server, id).find((item) => item.id === selected.id);
    if (!currentSelected) throw new Error('Timezone change removed a stored occurrence');
    const before = browserWriteSnapshot(server);
    const path = `/projects/alpha/tasks/${id}/occurrences/complete`;
    const pending = response(page, path);
    await page.getByRole('button', { name: 'Выполнить выбранные', exact: true }).click();
    const failed = await pending;
    expect(failed.status()).toBe(409);
    expect(await failed.json()).toMatchObject({
      ok: false,
      error: { code: 'CONFIG_CONFLICT', details: { scope: 'settings' } },
    });
    await expect(page.getByRole('region', { name: 'Ваш вариант', exact: true })).toContainText(
      'Europe/Moscow',
    );
    expect(browserWriteSnapshot(server)).toEqual(before);
    await page.reload();
    await openTaskActions(page);
    const group = row(page, selected.id).getByRole('group', {
      name: `Фактическое выполнение ${selected.id}`,
      exact: true,
    });
    await expect(group.getByLabel('Дата выполнения', { exact: true })).toHaveValue(entered.date);
    await expect(group.getByLabel('Время выполнения', { exact: true })).toHaveValue(entered.time);
    await expect(group).toContainText('Europe/Moscow');
    expect(await storedDraft(page, id)).toMatchObject({
      base: { expected_settings_revision: 1 },
      fields: { timezone: 'Europe/Moscow' },
    });
    const staleAgain = response(page, path);
    await page.getByRole('button', { name: 'Выполнить выбранные', exact: true }).click();
    expect((await staleAgain).status()).toBe(409);
    await expect(page.getByRole('region', { name: 'Текущая версия', exact: true })).toBeVisible();
    expect(browserWriteSnapshot(server)).toEqual(before);
    const completed = response(page, path);
    await page.getByRole('button', { name: 'Сохранить мой вариант ещё раз', exact: true }).click();
    const reply = await completed;
    expect(reply.status()).toBe(200);
    expect(mutationEnvelopeSchema.parse(reply.request().postDataJSON())).toMatchObject({
      expected_settings_revision: 2,
      payload: {
        occurrences: [
          {
            id: selected.id,
            expected_revision: currentSelected.revision,
            actual_completed_at: new Date(actual).toISOString(),
          },
        ],
      },
    });
    expect(browserOccurrences(server, id).find((item) => item.id === selected.id)).toMatchObject({
      actual_completed_at: actual,
      state: 'completed_late',
    });
    expect(completeAuditCount(server, selected.id)).toBe(1);
  } finally {
    await page.context().close();
    await server.close();
  }
});
