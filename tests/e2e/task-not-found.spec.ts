import { expect, test } from '@playwright/test';
import { boardProject, projectBoardServer } from '../fixtures/project-board.js';

test('a missing task offers a way back instead of a dead end', async ({ page }) => {
  const server = await projectBoardServer();
  try {
    const slug = boardProject.slug;
    const missing = '00000000-0000-4000-8000-000000000000';
    await page.goto(`${server.origin}/projects/${slug}/tasks/${missing}`);
    await expect(page.getByRole('alert')).toContainText('Задача не найдена.');
    const way = page.getByRole('navigation', { name: 'Куда перейти', exact: true });
    // «Повторить загрузку» asks for the task again without reloading the page.
    const again = page.waitForRequest((request) => request.url().includes(`/tasks/${missing}`));
    await page.evaluate('window.__sameDocument = true');
    await way.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await again;
    await expect(page.getByRole('alert')).toContainText('Задача не найдена.');
    expect(await page.evaluate('window.__sameDocument')).toBe(true);
    await expect(way.getByRole('link', { name: 'К задачам', exact: true })).toHaveAttribute(
      'href',
      '/tasks?all_projects=true',
    );
    await way.getByRole('link', { name: 'К проекту', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`, 'u'));
  } finally {
    await page.context().close();
    await server.close();
  }
});
