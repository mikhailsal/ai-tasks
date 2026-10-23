import { expect, test } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';

test('horizontal column navigation keeps the selected stage tab fully visible on narrow phones', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    await page.goto(server.origin + server.boardPath);
    const before = server.snapshot();
    const track = page.locator('.board-track');
    const tabs = page.getByRole('navigation', { name: 'Стадии проекта', exact: true });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await track.evaluate((element) => element.scrollTo({ left: 0 }));
      await expect(tabs.getByRole('button', { name: 'Идеи', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await track.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
      const selected = tabs.getByRole('button', { name: 'Готово', exact: true });
      await expect(selected).toHaveAttribute('aria-pressed', 'true');
      await expect(selected).toBeInViewport();
      const tabBox = await selected.boundingBox();
      const navBox = await tabs.boundingBox();
      if (!tabBox || !navBox) throw new Error('Missing stage navigation geometry');
      expect(tabBox.x).toBeGreaterThanOrEqual(navBox.x);
      expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(navBox.x + navBox.width + 1);
    }
    expect(server.snapshot()).toEqual(before);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('deadline urgency uses the server snapshot and filter explanations remain visible by default', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    const id = server.ids[0];
    const todayId = server.ids.at(-1);
    if (!id || !todayId) throw new Error('Missing deadline fixture');
    const deadline = new Date(Date.now() - 86_400_000).toISOString();
    const updated = await page.request.patch(
      `${server.origin}/api/v1/projects/board-review/tasks/${id}`,
      {
        headers: { Origin: server.origin, 'X-AI-Tasks-Mutation': '1' },
        data: server.envelope({ deadline }, { expected_revision: 1 }),
      },
    );
    expect(updated.status()).toBe(200);
    await page.clock.setFixedTime(new Date('2000-01-01T00:00:00Z'));
    await page.goto(server.origin + server.boardPath);
    const overdue = page.locator(`.board-task[data-task-id="${id}"] .board-date`);
    await expect(overdue).toContainText('Просрочено · вчера');
    await expect(overdue).toHaveClass(/board-date-overdue/u);
    await expect(overdue.locator('time')).toHaveAttribute('datetime', deadline);
    await expect(
      page.locator(`.board-task[data-task-id="${todayId}"] .board-date time`),
    ).toContainText(/сегодня/iu);
    await page.getByRole('button', { name: 'Фильтры задач', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Фильтры задач', exact: true });
    await expect(dialog.locator('.board-filter-explanation')).toContainText(
      'Приоритет, срок и поиск применяются вместе.',
    );
    await dialog.getByRole('button', { name: 'Ближайшие 3 дня', exact: true }).click();
    await expect(dialog.locator('.board-filter-explanation')).toContainText(
      'сегодня и два следующих дня',
    );
    await expect(dialog.locator('.board-filter-explanation')).toBeVisible();
    await expect(dialog.getByLabel('Точный день', { exact: true })).toBeHidden();
  } finally {
    await page.context().close();
    await server.close();
  }
});
