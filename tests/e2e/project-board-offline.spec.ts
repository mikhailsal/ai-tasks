import { expect, test } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';
import { offlineNavigation } from '../fixtures/offline-browser.js';

test('offline board reopening preserves cached columns and distinguishes an unfetched stage', async ({
  page,
  context,
}) => {
  const server = await projectBoardServer();
  const readStages = new Set<string>();
  const writes: string[] = [];
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return;
    if (request.method() !== 'GET') writes.push(request.url());
    if (url.pathname.endsWith('/board')) readStages.add(url.searchParams.get('status_id') ?? '');
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}${server.boardPath}`);
    const ideas = page.locator('.board-column[data-status-id="ideas"]');
    await expect(ideas.locator('.board-task')).toHaveCount(server.ids.length);
    await expect(ideas.locator('.board-drag-handle').first()).toBeEnabled();
    await expect(page.locator('.board-column[data-status-id="plan"] .board-snapshot')).toHaveCount(
      1,
    );
    expect(readStages.has('test')).toBe(false);
    await page.evaluate('navigator.serviceWorker.ready.then(() => undefined)');
    await expect
      .poll(() => page.evaluate('Boolean(navigator.serviceWorker.controller)'))
      .toBe(true);
    const before = await server.snapshot();

    await context.setOffline(true);
    await offlineNavigation(page);
    await expect(page.getByText(/Нет соединения/u).first()).toBeVisible();
    await expect(ideas.locator('.board-task')).toHaveCount(server.ids.length);
    await expect(ideas.locator('.board-read-error')).toHaveCount(0);
    await expect(ideas.getByText(/Нет сохранённых данных этой страницы/u)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Добавить задачу', exact: true })).toBeDisabled();
    for (const handle of await ideas.locator('.board-drag-handle').all())
      await expect(handle).toBeDisabled();

    await page
      .getByRole('navigation', { name: 'Стадии проекта', exact: true })
      .getByRole('button', { name: 'Тестирование', exact: true })
      .click();
    const unfetched = page.locator('.board-column[data-status-id="test"]');
    await expect(unfetched.locator('.board-read-error')).toBeVisible();
    await expect(unfetched).toContainText(/не сохранена|нет сохранённых данных/iu);
    await expect(unfetched.locator('.board-task')).toHaveCount(0);
    await expect(unfetched.getByText('Пока нет задач в этой стадии.', { exact: true })).toHaveCount(
      0,
    );

    await page
      .getByRole('navigation', { name: 'Стадии проекта', exact: true })
      .getByRole('button', { name: 'Идеи', exact: true })
      .click();
    await expect(ideas.locator('.board-task')).toHaveCount(server.ids.length);
    await expect(ideas.locator('.board-read-error')).toHaveCount(0);
    await expect(ideas.getByText(/Нет сохранённых данных этой страницы/u)).toHaveCount(0);

    const reopened = await context.newPage();
    try {
      await offlineNavigation(reopened, `${server.origin}${server.boardPath}`);
      const saved = reopened.locator('.board-column[data-status-id="ideas"]');
      await expect(saved.locator('.board-task')).toHaveCount(server.ids.length);
      await expect(saved.locator('.board-read-error')).toHaveCount(0);
      await expect(saved.getByText(/Нет сохранённых данных этой страницы/u)).toHaveCount(0);
      await expect(
        reopened.getByRole('button', { name: 'Добавить задачу', exact: true }),
      ).toBeDisabled();
      expect(writes).toEqual([]);
      expect(await server.snapshot()).toEqual(before);
    } finally {
      await reopened.close();
    }
  } finally {
    await context.setOffline(false);
    await context.close();
    await server.close();
  }
});
