import { expect, test } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';

test('history applying a filter cancels a held drag without sending a position write', async ({
  page,
}) => {
  const server = await projectBoardServer();
  const priority = JSON.stringify({ model: 'classic', level: 'low' });
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/position'))
      writes.push(request.url());
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}${server.boardPath}&priority=${encodeURIComponent(priority)}`);
    const source = page.locator('.board-column[data-status-id="ideas"]');
    const cards = source.locator('.board-task');
    await expect(cards).toHaveCount(1);
    await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
    await expect(cards).toHaveCount(server.ids.length);
    const first = cards.first();
    await expect(first.locator('.board-drag-handle')).toBeEnabled();
    const handle = await first.locator('.board-drag-handle').boundingBox();
    const second = await cards.nth(1).boundingBox();
    if (!handle || !second) throw Error('Missing draggable card geometry');
    const before = await server.snapshot();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await expect(page.locator('.board-drag-ghost')).toBeVisible();
    await page.mouse.move(190, second.y + second.height - 3, { steps: 10 });

    // Browser history can change the applied scope while pointer capture remains active.
    const filtered = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        url.pathname.endsWith('/board') &&
        url.searchParams.get('status_id') === 'ideas' &&
        url.searchParams.get('priority') === priority
      );
    });
    await page.goBack();
    expect((await filtered).status()).toBe(200);
    await expect(page.locator('.board-filter-summary')).toContainText('Низкий');
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator('.board-drag-handle')).toBeDisabled();
    // Let the existing drag tick observe the new rendered membership before release.
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect(page.locator('.board-drag-ghost')).toHaveCount(0);
    await page.waitForTimeout(500);

    expect(writes).toEqual([]);
    expect(await server.snapshot()).toEqual(before);
    await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
    await expect(cards.first()).toHaveAttribute('data-task-id', server.ids[0] ?? 'missing');
  } finally {
    await page.context().close();
    await server.close();
  }
});
