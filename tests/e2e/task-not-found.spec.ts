import { expect, test } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';

test('a missing task offers a way back instead of a dead end', async ({ page }) => {
  const server = await projectBoardServer();
  try {
    const slug = server.boardPath.split('/')[2] ?? '';
    await page.goto(`${server.origin}/projects/${slug}/tasks/00000000-0000-4000-8000-000000000000`);
    await expect(page.getByRole('alert')).toContainText('Задача не найдена.');
    const way = page.getByRole('navigation', { name: 'Куда перейти', exact: true });
    await expect(
      way.getByRole('button', { name: 'Повторить загрузку', exact: true }),
    ).toBeVisible();
    await way.getByRole('link', { name: 'К проекту', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`, 'u'));
  } finally {
    await page.context().close();
    await server.close();
  }
});
