import { expect, test } from '@playwright/test';
import { recurrenceBrowserServer, seedBrowserRecurring } from '../fixtures/recurrence-browser.js';
import { createPassRecorder } from '../../src/core/worker/record-pass.js';

/** Spec 011 US3: people see that the worker is not running, on every dependent screen. */
const never = 'Обработчик повторений ещё не запускался';
const advisory = 'Обработчик повторений ещё не запускался для этого проекта';

test('the worker notice shows on the project, the list and the occurrences, then goes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 932 });
  const server = await recurrenceBrowserServer();
  try {
    const id = await seedBrowserRecurring(server, { active: true });
    await page.goto(`${server.origin}/projects/alpha`);
    const notice = page.getByRole('complementary', { name: 'Обработчик повторений' });
    await expect(notice).toContainText(never);
    await expect(notice).toContainText('worker run --project alpha');
    await page.goto(`${server.origin}/`);
    await expect(page.locator('.project-card').filter({ hasText: never })).toHaveCount(1);
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await expect(
      page.getByRole('complementary', { name: 'Обратите внимание' }).getByText(advisory),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Действия с задачей' }).click();
    const occurrences = page.getByRole('region', { name: 'Повторения задачи' });
    await expect(occurrences.getByText(advisory)).toBeVisible();
    await expect(occurrences).toContainText('worker run --project alpha');
    await expect(occurrences).not.toContainText(/recurring worker|Start the service/u);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);

    createPassRecorder(server.fixture.connection, 'alpha')(Date.now());
    await page.goto(`${server.origin}/projects/alpha`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(never)).toHaveCount(0);
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(advisory)).toHaveCount(0);
  } finally {
    await page.context().close();
    await server.close();
  }
});
