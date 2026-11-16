import { expect, test } from '@playwright/test';
import { insecureOrigin, proxyApplication } from '../fixtures/insecure-origin.js';
import { offlineNavigation } from '../fixtures/offline-browser.js';
import { projectBoardServer } from '../fixtures/project-board.js';

// Local network mode serves plain HTTP. Browsers allow a service worker only in a secure
// context, so an open tab keeps cached reads while a cold offline reopen cannot load the shell.
test('plain HTTP network origin keeps an open tab readable offline but cannot reopen without the network', async ({
  page,
  context,
}) => {
  const server = await projectBoardServer();
  const network = await proxyApplication(context, server.origin);
  const writes: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET')
      writes.push(request.url());
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${insecureOrigin}${server.boardPath}`);
    const ideas = page.locator('.board-column[data-status-id="ideas"]');
    await expect(ideas.locator('.board-task')).toHaveCount(server.ids.length);
    expect(
      await page.evaluate(() => ({
        secure: isSecureContext,
        controlled: Boolean(navigator.serviceWorker?.controller),
      })),
    ).toEqual({ secure: false, controlled: false });
    const before = await server.snapshot();

    await network.setOffline(true);
    await expect(page.getByText(/Нет соединения/u).first()).toBeVisible();
    await expect(ideas.locator('.board-task')).toHaveCount(server.ids.length);
    await expect(ideas.locator('.board-read-error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Добавить задачу', exact: true })).toBeDisabled();

    const reopened = await context.newPage();
    await offlineNavigation(reopened, `${insecureOrigin}${server.boardPath}`);
    await expect(reopened.locator('.board-task')).toHaveCount(0);
    await expect(reopened.getByRole('heading')).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(await server.snapshot()).toEqual(before);
  } finally {
    await network.setOffline(false);
    await context.close();
    await server.close();
  }
});
