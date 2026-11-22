import { expect, test, type Page } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';

async function visibleColumns(page: Page) {
  return page.locator('.board-column').evaluateAll(
    (columns) =>
      columns.filter((column) => {
        const rect = column.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth && rect.width > 0;
      }).length,
  );
}

test('a wide screen shows several board stages side by side; a phone keeps one (QA F15)', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    await page.setViewportSize({ width: 1568, height: 900 });
    await page.goto(`${server.origin}${server.boardPath}`);
    await expect(page.locator('.board-column[data-status-id="plan"] .board-task')).toHaveCount(1);
    expect(await visibleColumns(page)).toBeGreaterThanOrEqual(4);
    // Every stage in view is read, not only the active one and its neighbour. The placeholder
    // is shown only for a stage that is not read at all, never while one is loading.
    const unreadInView = () =>
      page.locator('.board-column').evaluateAll(
        (columns) =>
          columns.filter((column) => {
            const rect = column.getBoundingClientRect();
            return (
              rect.right > 0 &&
              rect.left < window.innerWidth &&
              column.textContent?.includes('Откройте стадию, чтобы загрузить задачи.')
            );
          }).length,
      );
    await expect.poll(unreadInView).toBe(0);
    // The last tab stays chosen although the track cannot scroll it to the left edge.
    const tabs = page.locator('.board-stage-tabs button');
    await tabs.last().click();
    await expect(tabs.last()).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    await expect(tabs.last()).toHaveAttribute('aria-pressed', 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => visibleColumns(page)).toBe(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('on a wide screen a dragged card drops into the stage under the pointer (QA F15)', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    await page.setViewportSize({ width: 1568, height: 900 });
    await page.goto(`${server.origin}${server.boardPath}`);
    const ideas = page.locator('.board-column[data-status-id="ideas"] .board-task');
    await expect(ideas.first().locator('.board-drag-handle')).toBeEnabled();
    const firstId = server.ids[0];
    const handle = await ideas.first().locator('.board-drag-handle').boundingBox();
    const plan = await page.locator('.board-column[data-status-id="plan"]').boundingBox();
    if (!firstId || !handle || !plan) throw Error('Missing draggable geometry');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(plan.x + plan.width / 2, plan.y + 200, { steps: 12 });
    const moved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/position'),
    );
    await page.mouse.up();
    expect((await moved).status()).toBe(200);
    await expect(
      page.locator(`.board-column[data-status-id="plan"] .board-task[data-task-id="${firstId}"]`),
    ).toBeVisible();
  } finally {
    await page.context().close();
    await server.close();
  }
});
