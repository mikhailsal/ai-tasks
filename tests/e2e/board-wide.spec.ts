import { expect, test } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';

test('a wide screen shows several board stages side by side; a phone keeps one (QA F15)', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    const visible = async () =>
      page.locator('.board-column').evaluateAll(
        (columns) =>
          columns.filter((column) => {
            const rect = column.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= window.innerWidth && rect.width > 0;
          }).length,
      );
    await page.setViewportSize({ width: 1568, height: 900 });
    await page.goto(`${server.origin}${server.boardPath}`);
    await expect(page.locator('.board-column').first()).toBeVisible();
    expect(await visible()).toBeGreaterThanOrEqual(4);
    // Every stage in view is loaded, not only the active one and its neighbour.
    await expect(page.getByText('Откройте стадию, чтобы загрузить задачи.')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(visible).toBe(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  } finally {
    await page.context().close();
    await server.close();
  }
});
