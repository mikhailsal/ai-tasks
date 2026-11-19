import { expect, test } from '@playwright/test';
import { recurrenceBrowserServer, seedBrowserRecurring } from '../fixtures/recurrence-browser.js';

test('occurrence rows show local times and a readable window, not UTC ISO or ms', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    const first = Date.now() - 2 * 86400000;
    const id = await seedBrowserRecurring(server, { first, active: true, activeSince: first });
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await page.getByRole('button', { name: 'Действия с задачей', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Действия с задачей', exact: true });
    await sheet.getByRole('button', { name: 'Обработать наступившие сроки', exact: true }).click();
    const row = sheet.getByRole('article', { name: /^Повторение / }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(/Срок: \d{1,2} [а-я]+\. \d{4} г\., \d{2}:\d{2}/u);
    await expect(row).toContainText('окно подтверждения:');
    await expect(row).not.toContainText(/\d{4}-\d{2}-\d{2}T|\.\d{3}Z|\d+ мс|поколение/u);
    // The exact instant stays available on hover.
    await expect(row.locator('time').first()).toHaveAttribute('title', /Z \(UTC\)$/u);
  } finally {
    await page.context().close();
    await server.close();
  }
});
