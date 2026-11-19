import { expect, test } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';

test('the first visit installs the app shell without claiming an update (QA F12)', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    await page.goto(`${server.origin}/projects`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate('navigator.serviceWorker.ready.then(() => undefined)');
    // Give the installing worker time to pass through «installed» and activate.
    await page.waitForTimeout(1500);
    await expect(page.getByText('Доступна новая версия приложения', { exact: false })).toHaveCount(
      0,
    );
  } finally {
    await page.context().close();
    await server.close();
  }
});
