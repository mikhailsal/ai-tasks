import { expect, test } from '@playwright/test';
import {
  mutationEnvelopeSchema,
  mutationSuccessEnvelopeSchema,
} from '../../src/schema/envelopes.js';
import {
  browserParent,
  browserWriteSnapshot,
  changeBrowserTimezone,
  recurrenceBrowserServer,
  seedBrowserRecurring,
} from '../fixtures/recurrence-browser.js';

test('stale manual tick reconciliation retains tick intent and never reconfigures the schedule', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    const id = await seedBrowserRecurring(server, {
      active: true,
      first: Date.now() + 10 * 86_400_000,
    });
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    const manual = page.getByRole('button', { name: 'Обработать наступившие сроки', exact: true });
    await expect(manual).toBeEnabled();
    await changeBrowserTimezone(server);
    const parent = browserParent(server.fixture, id);
    const recurrenceTables = () =>
      ['schedule_generations', 'recurrence_state', 'recurrence_intervals', 'occurrences'].map(
        (table) =>
          server.fixture.connection.sqlite
            .prepare(`SELECT * FROM ${table} WHERE task_id=? ORDER BY rowid`)
            .all(id),
      );
    const recurrenceBefore = recurrenceTables();
    const before = browserWriteSnapshot(server);
    const path = '/api/v1/projects/alpha/recurrence/tick';
    const requests: { method: string; path: string }[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['POST', 'PUT', 'PATCH'].includes(request.method()))
        requests.push({ method: request.method(), path: url.pathname });
    });
    const failedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === path,
    );
    await manual.click();
    const failed = await failedResponse;
    expect(failed.status()).toBe(409);
    expect(await failed.json()).toMatchObject({
      ok: false,
      error: { code: 'CONFIG_CONFLICT', details: { scope: 'settings' } },
    });
    const failedInput = mutationEnvelopeSchema.parse(failed.request().postDataJSON());
    expect(browserWriteSnapshot(server)).toEqual(before);
    const proposed = page.getByRole('region', { name: 'Ваш вариант', exact: true });
    await expect(proposed).toContainText('Обработать наступившие сроки');
    await expect(proposed).toContainText(id);
    await expect(proposed).not.toContainText('confirmationWindowMs');

    const retriedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === path,
    );
    await page.getByRole('button', { name: 'Сохранить мой вариант ещё раз', exact: true }).click();
    const retried = await retriedResponse;
    expect(retried.status()).toBe(200);
    mutationSuccessEnvelopeSchema.parse(await retried.json());
    const retriedInput = mutationEnvelopeSchema.parse(retried.request().postDataJSON());
    expect(retriedInput.operation_id).not.toBe(failedInput.operation_id);
    expect(retriedInput.expected_settings_revision).toBe(2);
    expect(retriedInput.expected_config_revision).toBe(failedInput.expected_config_revision);
    expect(retriedInput.payload).toEqual({
      tasks: [{ task_id: id, expected_revision: parent.revision }],
    });
    expect(requests).toEqual([
      { method: 'POST', path },
      { method: 'POST', path },
    ]);
    expect(recurrenceBefore[0]).toHaveLength(2);
    expect(recurrenceTables()).toEqual(recurrenceBefore);
  } finally {
    await page.close();
    await server.close();
  }
});
