import { expect, test } from '@playwright/test';
import {
  browserRecurrenceInput,
  recurrenceBrowserServer,
  seedBrowserRecurring,
} from '../fixtures/recurrence-browser.js';
import { controlRecurrence } from '../../src/core/recurrence/control.js';

/** Specs 010 and 012: people see the advisory where the task is shown, at 430 px. */
const draftText = 'This recurring task generates no occurrences in its current status.';

test('a draft recurring task shows the notice on the task and in the list, then loses it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 932 });
  const server = await recurrenceBrowserServer();
  try {
    const id = await seedBrowserRecurring(server, { active: false });
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    const notice = page.getByRole('complementary', { name: 'Обратите внимание' });
    await expect(notice).toContainText(draftText);
    await expect(notice).toContainText('Move it to an active status');
    await expect(notice).toContainText('По данным на');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.goto(`${server.origin}/?project_slug=alpha`);
    await expect(page.locator('.task-card').filter({ hasText: draftText })).toHaveCount(1);
    controlRecurrence(
      server.fixture.human,
      'alpha',
      id,
      browserRecurrenceInput(server.fixture, { to_status_id: 'active' }, id),
    );
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(draftText)).toHaveCount(0);
  } finally {
    await page.context().close();
    await server.close();
  }
});
