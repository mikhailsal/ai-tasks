import { expect, test } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';

for (const method of ['link', 'browser'] as const) {
  test(`unsaved task confirms ${method} Back and retains the exact draft`, async ({ page }) => {
    const server = await projectBoardServer();
    try {
      const id = server.ids[0];
      if (!id) throw new Error('Missing task fixture');
      await page.goto(`${server.origin}${server.boardPath}`);
      await page.locator(`a[href*="/tasks/${id}"]`).first().click();
      const description = page.getByLabel('Описание', { exact: true });
      const source = '  Несохранённый текст\n\n**Все символы**  ';
      await description.fill(source);
      const before = server.snapshot();
      async function leave() {
        if (method === 'browser') await page.evaluate(() => window.history.back());
        else await page.getByRole('link', { name: 'Назад на доску проекта', exact: true }).click();
      }
      const rejected = page.waitForEvent('dialog');
      const leaving = leave();
      const dialog = await rejected;
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('несохранённые');
      await dialog.dismiss();
      await leaving;
      await expect(page).toHaveURL(new RegExp(`/tasks/${id}`));
      await expect(description).toHaveValue(source);
      const accepted = page.waitForEvent('dialog');
      const leavingAgain = leave();
      await (await accepted).accept();
      await leavingAgain;
      await expect(page).toHaveURL(`${server.origin}${server.boardPath}`);
      await page.locator(`a[href*="/tasks/${id}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/tasks/${id}`));
      await expect(description).toHaveValue(source);
      expect(server.snapshot()).toEqual(before);
    } finally {
      await page.context().close();
      await server.close();
    }
  });
}
