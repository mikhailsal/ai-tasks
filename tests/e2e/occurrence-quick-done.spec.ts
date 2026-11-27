import { expect, test } from '@playwright/test';
import {
  browserOccurrences,
  recurrenceBrowserServer,
  seedBrowserRecurring,
} from '../fixtures/recurrence-browser.js';

test('one tap marks an occurrence done, confirms it, and «План» links straight to it', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    const first = Date.now() - 2 * 86400000;
    const id = await seedBrowserRecurring(server, { first, active: true, activeSince: first });
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    // The task page offers the action directly; it opens the sheet at the occurrences.
    await page.getByRole('button', { name: 'Отметить выполнение', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Действия с задачей', exact: true });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Обработать наступившие сроки', exact: true }).click();
    const done = sheet.getByRole('button', { name: 'Отметить выполненным', exact: true }).first();
    await expect(done).toBeVisible();
    await expect(done).toBeInViewport();
    const open = browserOccurrences(server, id).filter((row) => row.state === 'debt');
    expect(open.length).toBeGreaterThanOrEqual(2);
    await done.click();
    await expect(
      sheet.getByRole('status').filter({ hasText: 'Отмечено выполненным: 1.' }),
    ).toBeVisible();
    const after = browserOccurrences(server, id);
    expect(after.filter((row) => row.state === 'debt')).toHaveLength(open.length - 1);
    expect(after.some((row) => ['completed', 'completed_late'].includes(row.state))).toBe(true);

    await page.goto(`${server.origin}/agenda`);
    await page.getByRole('link', { name: 'Отметить выполнение', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${id}\\?occurrences=open$`, 'u'));
    await expect(
      page.getByRole('dialog', { name: 'Действия с задачей', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Отметить выполненным', exact: true }).first(),
    ).toBeInViewport();
  } finally {
    await page.context().close();
    await server.close();
  }
});
