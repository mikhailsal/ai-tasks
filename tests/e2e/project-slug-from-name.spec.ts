import { expect, test } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';

test('a new project gets its link from a Cyrillic name and saves without touching the slug', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}/projects`);
    await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
    const name = page.getByLabel('Название проекта', { exact: true });
    await name.fill('Щука и ёж');
    const slug = page.getByLabel('Slug проекта', { exact: true });
    await expect(slug).toHaveValue('shchuka-i-ezh');
    // The link is visible next to the name, not only in «Дополнительные настройки».
    await expect(page.getByText('Ссылка проекта: /projects/shchuka-i-ezh')).toBeVisible();
    await name.fill('Щука и ёж 2');
    await expect(slug).toHaveValue('shchuka-i-ezh-2');
    // A slug typed by hand is kept when the name changes again.
    await slug.fill('pike');
    await name.fill('Щука');
    await expect(slug).toHaveValue('pike');
    await slug.fill('');
    await name.fill('Ёлка');
    await expect(slug).toHaveValue('elka');

    await page.getByLabel('Эмодзи проекта', { exact: true }).fill('🎄');
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/projects/elka',
    );
    await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
    expect((await created).status()).toBe(201);
  } finally {
    await page.context().close();
    await server.close();
  }
});
