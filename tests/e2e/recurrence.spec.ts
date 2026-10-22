import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod/mini';
import { updateTask } from '../../src/core/tasks/commands.js';
import { mutationSuccessEnvelopeSchema } from '../../src/schema/envelopes.js';
import { ordinaryInput } from '../fixtures/ordinary-work.js';
import {
  recurrenceBrowserServer,
  seedBrowserRecurring,
  browserOccurrences,
  browserWriteSnapshot,
  browserParent,
  changeBrowserTimezone,
} from '../fixtures/recurrence-browser.js';
function mutationResponse(page: Page, path: string, method = 'POST') {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname === `/api/v1${path}`,
  );
}
function occurrence(page: Page, id: string) {
  return page.getByRole('article', { name: `Повторение ${id}`, exact: true });
}
async function minimumTarget(control: Locator) {
  const bounds = await control.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
}
async function tick(page: Page, id: string) {
  const response = mutationResponse(page, '/projects/alpha/recurrence/tick');
  await page.getByRole('button', { name: 'Обработать наступившие сроки', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(
    page.getByRole('article', { name: new RegExp('^Повторение ') }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Проверка оборудования', exact: true }),
  ).toBeVisible();
  expect(id).toMatch(/^[a-f0-9-]{36}$/u);
}
// These labels define structured controls for T075/T076; no JSON editor or hidden time defaults.
test('recurring creation requires explicit anchor, policy and window and keeps timing independent of miss policy', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    await page.goto(`${server.origin}/projects/alpha/tasks/new`);
    await page.getByLabel('Название задачи', { exact: true }).fill('Проверка оборудования');
    await page.getByLabel('Тип задачи', { exact: true }).selectOption('recurring');
    await expect(page.getByLabel('Правило пропуска', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Окно подтверждения, мс', { exact: true })).toHaveValue('');
    const save = page.getByRole('button', { name: 'Сохранить', exact: true });
    if (await save.isEnabled()) await save.click();
    expect(
      server.fixture.connection.sqlite.prepare('SELECT count(*) FROM tasks').pluck().get(),
    ).toBe(0);
    await page.getByLabel('Первая дата', { exact: true }).fill('2090-01-08');
    await page.getByLabel('Первое время', { exact: true }).fill('13:02:03.123');
    await page.getByLabel('Режим повторения', { exact: true }).selectOption('calendar');
    await page.getByLabel('Правило пропуска', { exact: true }).selectOption('record_miss');
    await page.getByLabel('Окно подтверждения, мс', { exact: true }).fill('2592000000');
    await page.getByLabel('Режим повторения', { exact: true }).selectOption('after_completion');
    await expect(page.getByLabel('Правило пропуска', { exact: true })).toHaveValue('record_miss');
    await page.getByLabel('Единица интервала', { exact: true }).selectOption('hours');
    await page.getByLabel('Интервал', { exact: true }).fill('2');
    const saved = mutationResponse(page, '/projects/alpha/tasks');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const result = mutationSuccessEnvelopeSchema.parse(await response.json());
    const id = z.object({ id: z.uuid() }).parse(result.data).id;
    const generation = z
      .object({
        mode: z.string(),
        schedule: z.string(),
        first_deadline: z.number(),
        miss_policy: z.string(),
        window_ms: z.number(),
      })
      .parse(
        server.fixture.connection.sqlite
          .prepare('SELECT * FROM schedule_generations WHERE task_id=?')
          .get(id),
      );
    expect(generation).toMatchObject({
      mode: 'after_completion',
      miss_policy: 'record_miss',
      window_ms: 2592000000,
      first_deadline: Date.parse('2090-01-08T10:02:03.123Z'),
    });
    expect(JSON.parse(generation.schedule)).toEqual({
      mode: 'after_completion',
      unit: 'hours',
      every: 2,
    });
    await expect(
      page.getByRole('heading', { name: 'Проверка оборудования', exact: true }),
    ).toBeVisible();
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const root = await page.locator('#root').boundingBox();
      expect(root?.width).toBeLessThanOrEqual(430);
      expect(root?.x).toBeCloseTo((width - (root?.width ?? 0)) / 2, 0);
      expect(await page.evaluate('document.documentElement.scrollWidth')).toBeLessThanOrEqual(
        width,
      );
    }
    await minimumTarget(page.getByRole('button', { name: 'Активно', exact: true }));
  } finally {
    await page.close();
    await server.close();
  }
});
test('manual tick exposes explicit debt selection, per-row actual and frozen instruction snapshots', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    const first = Date.now() - 2 * 86400000;
    const id = await seedBrowserRecurring(server, {
      first,
      active: true,
      activeSince: first,
    });
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await tick(page, id);
    const rows = browserOccurrences(server, id);
    const debts = rows.filter((row) => row.state === 'debt');
    expect(debts.length).toBeGreaterThanOrEqual(2);
    const selected = debts[0];
    const untouched = debts[1];
    if (!selected || !untouched) throw new Error('Expected two real materialized debts');
    updateTask(
      server.fixture.human,
      'alpha',
      id,
      ordinaryInput(
        server.fixture,
        { description: 'Новая инструкция, только для будущих повторений' },
        { revision: browserParent(server.fixture, id).revision },
      ),
    );
    await page.reload();
    const row = occurrence(page, selected.id);
    await row.getByRole('button', { name: 'Сохранённая инструкция', exact: true }).click();
    await expect(
      row.getByRole('region', { name: 'Сохранённая инструкция', exact: true }),
    ).toContainText('Сохранённая');
    await expect(row).not.toContainText('Новая инструкция, только для будущих повторений');
    await row.getByLabel(`Выбрать повторение ${selected.id}`, { exact: true }).check();
    const actual = row.getByRole('group', {
      name: `Фактическое выполнение ${selected.id}`,
      exact: true,
    });
    const actualInstant = new Date(selected.deadline + 60000);
    const moscow = new Date(actualInstant.getTime() + 3 * 3600000).toISOString();
    await actual.getByLabel('Дата выполнения', { exact: true }).fill(moscow.slice(0, 10));
    await actual.getByLabel('Время выполнения', { exact: true }).fill(moscow.slice(11, 23));
    const completed = mutationResponse(page, `/projects/alpha/tasks/${id}/occurrences/complete`);
    await page.getByRole('button', { name: 'Выполнить выбранные', exact: true }).click();
    expect((await completed).status()).toBe(200);
    const stored = browserOccurrences(server, id);
    expect(stored.find((item) => item.id === selected.id)).toMatchObject({
      state: 'completed_late',
      actual_completed_at: actualInstant.getTime(),
    });
    expect(stored.find((item) => item.id === untouched.id)).toEqual(untouched);
    expect(stored.find((item) => item.id === selected.id)?.completion_recorded_at).toBeGreaterThan(
      actualInstant.getTime(),
    );
    await expect(row).toContainText('Фактическое выполнение');
    await expect(row).toContainText('Записано');
    await expect(
      page.getByRole('button', { name: 'Обработать наступившие сроки', exact: true }),
    ).toBeEnabled();
  } finally {
    await page.close();
    await server.close();
  }
});
test('paused cancellation requires reason, selects future pending only and leaves debt unforgiven', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    const id = await seedBrowserRecurring(server, { first: Date.now() - 86400000, active: true });
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await tick(page, id);
    const pause = mutationResponse(page, `/projects/alpha/tasks/${id}/recurrence/control`);
    await page.getByRole('button', { name: 'Пауза', exact: true }).click();
    expect((await pause).status()).toBe(200);
    const rows = browserOccurrences(server, id);
    const debt = rows.find((row) => row.state === 'debt');
    const future = rows.find((row) => row.state === 'pending' && row.deadline > Date.now());
    if (!debt || !future) throw new Error('Expected real debt and future pending obligation');
    await occurrence(page, debt.id)
      .getByLabel(`Выбрать повторение ${debt.id}`, { exact: true })
      .check();
    const before = browserWriteSnapshot(server);
    await expect(
      page.getByRole('button', { name: 'Отменить выбранные', exact: true }),
    ).toBeDisabled();
    expect(browserWriteSnapshot(server)).toEqual(before);
    await occurrence(page, debt.id)
      .getByLabel(`Выбрать повторение ${debt.id}`, { exact: true })
      .uncheck();
    await occurrence(page, future.id)
      .getByLabel(`Выбрать повторение ${future.id}`, { exact: true })
      .check();
    await expect(
      page.getByRole('button', { name: 'Отменить выбранные', exact: true }),
    ).toBeDisabled();
    const reason = 'Обслуживание перенесено по решению владельца';
    await page.getByLabel('Причина отмены', { exact: true }).fill(reason);
    const cancelled = mutationResponse(page, `/projects/alpha/tasks/${id}/occurrences/cancel`);
    await page.getByRole('button', { name: 'Отменить выбранные', exact: true }).click();
    expect((await cancelled).status()).toBe(200);
    expect(browserOccurrences(server, id).find((row) => row.id === future.id)).toMatchObject({
      state: 'cancelled',
      cancel_reason: reason,
    });
    expect(browserOccurrences(server, id).find((row) => row.id === debt.id)).toEqual(debt);
    expect(browserParent(server.fixture, id).status_id).toBe('paused');
  } finally {
    await page.close();
    await server.close();
  }
});
test('timezone conflict preserves recurrence draft and original base across reload', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    const id = await seedBrowserRecurring(server, { active: true });
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await page.getByRole('button', { name: 'Изменить повторение', exact: true }).click();
    await page.getByLabel('Окно подтверждения, мс', { exact: true }).fill('123456');
    const snapshots = browserOccurrences(server, id);
    await changeBrowserTimezone(server);
    const before = browserWriteSnapshot(server);
    const conflict = mutationResponse(page, `/projects/alpha/tasks/${id}/recurrence`, 'PUT');
    await page.getByRole('button', { name: 'Сохранить повторение', exact: true }).click();
    const response = await conflict;
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'CONFIG_CONFLICT', details: { scope: 'settings' } },
    });
    await expect(page.getByRole('region', { name: 'Текущая версия', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ваш вариант', exact: true })).toContainText(
      '123456',
    );
    await expect(page.getByLabel('Окно подтверждения, мс', { exact: true })).toHaveValue('123456');
    expect(browserWriteSnapshot(server)).toEqual(before);
    const originalIds = new Set(snapshots.map((item) => item.id));
    expect(browserOccurrences(server, id).filter((item) => originalIds.has(item.id))).toEqual(
      snapshots,
    );
    await page.reload();
    await page.getByRole('button', { name: 'Изменить повторение', exact: true }).click();
    await expect(page.getByLabel('Окно подтверждения, мс', { exact: true })).toHaveValue('123456');
    expect(browserWriteSnapshot(server)).toEqual(before);
  } finally {
    await page.close();
    await server.close();
  }
});
test('direct recurring restore requires transition-specific consent and restores paused without hidden activation', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer(true);
  try {
    const id = await seedBrowserRecurring(server, { archived: true });
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    const before = browserWriteSnapshot(server);
    await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Подтвердите переход', exact: true });
    await expect(dialog).toContainText('Проверка оборудования');
    await expect(dialog).toContainText('Архив');
    await expect(dialog).toContainText('Пауза');
    await expect(dialog.getByRole('button', { name: 'Подтвердить', exact: true })).toBeDisabled();
    expect(browserWriteSnapshot(server)).toEqual(before);
    await dialog.getByLabel('Текст подтверждения', { exact: true }).fill('  \n ');
    await expect(dialog.getByRole('button', { name: 'Подтвердить', exact: true })).toBeDisabled();
    expect(browserWriteSnapshot(server)).toEqual(before);
    const userText = 'Проверил последствия: восстановить только на паузе.\nПродолжение отдельно.';
    await dialog.getByLabel('Текст подтверждения', { exact: true }).fill(userText);
    const restored = mutationResponse(page, `/projects/alpha/tasks/${id}/restore`);
    await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    const response = await restored;
    expect(response.status()).toBe(200);
    const result = mutationSuccessEnvelopeSchema.parse(await response.json());
    const sent = response.request().postDataJSON();
    expect(sent).toMatchObject({
      payload: { confirmation: { asserted: true, user_text: userText } },
    });
    expect(browserParent(server.fixture, id)).toMatchObject({
      status_id: 'paused',
      archived_at: null,
    });
    expect(browserOccurrences(server, id)).toEqual([]);
    const audit = z
      .object({ confirmation: z.string(), config_snapshot: z.string() })
      .parse(
        server.fixture.connection.sqlite
          .prepare('SELECT * FROM audit_records WHERE operation_id=? AND entity_id=?')
          .get(result.meta.operation_id, id),
      );
    expect(JSON.parse(audit.confirmation)).toEqual({ asserted: true, user_text: userText });
    expect(JSON.parse(audit.config_snapshot)).toMatchObject({
      recurring_workflow: {
        transitions: expect.arrayContaining([
          expect.objectContaining({ from: 'archived', to: 'paused', requires_confirmation: true }),
        ]),
      },
    });
    expect(
      server.fixture.connection.sqlite
        .prepare(
          "SELECT * FROM recurrence_intervals WHERE task_id=? AND behavior='active' AND end_at IS NULL",
        )
        .all(id),
    ).toEqual([]);
  } finally {
    await page.close();
    await server.close();
  }
});
