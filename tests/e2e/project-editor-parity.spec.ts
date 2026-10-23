import { expect, test } from '@playwright/test';
import { boardProject, projectBoardServer } from '../fixtures/project-board.js';

for (const width of [320, 390]) {
  test(`${width}px project editor keeps sketch header, primary fields and save actions visible`, async ({
    page,
  }) => {
    const server = await projectBoardServer();
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/'))
        writes.push(request.url());
    });
    try {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${server.origin}${server.boardPath}`);
      await page
        .getByRole('navigation', { name: 'Стадии проекта', exact: true })
        .getByRole('button', { name: 'Планирование', exact: true })
        .click();
      await page.getByRole('link', { name: 'Редактировать проект', exact: true }).click();
      await expect(page.getByLabel('Название проекта', { exact: true })).toHaveValue(
        boardProject.name,
      );
      const back = page.getByRole('button', { name: 'Назад на доску проекта', exact: true });
      await expect(back).toBeInViewport();
      await expect(
        page.getByRole('heading', { name: 'Редактирование проекта', exact: true }),
      ).toBeVisible();
      const name = page.getByLabel('Название проекта', { exact: true });
      const description = page.getByLabel('Описание проекта', { exact: true });
      const priority = page.getByLabel('Приоритет проекта', { exact: true });
      for (const field of [name, description, priority]) await expect(field).toBeInViewport();
      const nameBox = await name.boundingBox();
      const descriptionBox = await description.boundingBox();
      const priorityBox = await priority.boundingBox();
      if (!nameBox || !descriptionBox || !priorityBox) throw Error('Missing project fields');
      expect(nameBox.y).toBeLessThan(descriptionBox.y);
      expect(descriptionBox.y).toBeLessThan(priorityBox.y);
      await expect(page.getByLabel('Slug проекта', { exact: true })).toBeHidden();
      await expect(page.getByLabel('Эмодзи проекта', { exact: true })).toBeHidden();
      const save = page.getByRole('button', { name: 'Сохранить изменения', exact: true });
      await expect(save).toHaveText('Сохранить');
      await expect(save).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Отмена', exact: true })).toBeInViewport();

      await page.locator('summary').filter({ hasText: 'Дополнительные настройки' }).click();
      await expect(page.getByLabel('Slug проекта', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Slug проекта', { exact: true })).toBeDisabled();
      await expect(page.getByLabel('Эмодзи проекта', { exact: true })).toBeVisible();
      await page.locator('.project-editor-content').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(save).toBeInViewport();
      await expect(back).toBeInViewport();
      await back.click();
      await expect(page).toHaveURL(`${server.origin}${server.boardPath}`);
      await expect(page.locator('.board-stage-tabs button[aria-pressed="true"]')).toHaveText(
        'Планирование',
      );
      expect(writes).toEqual([]);
    } finally {
      await page.context().close();
      await server.close();
    }
  });
}

test('project editor saves visible fields through existing guarded project mutation', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}${server.boardPath}`);
    await page.getByRole('link', { name: 'Редактировать проект', exact: true }).click();
    const name = page.getByLabel('Название проекта', { exact: true });
    await expect(name).toHaveValue(boardProject.name);
    await name.fill('Обновлённый проект');
    await page
      .getByLabel('Описание проекта', { exact: true })
      .fill('## Точный исходник\n\nОписание проекта.');
    await page.getByLabel('Приоритет проекта', { exact: true }).fill('7');
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/projects/${boardProject.slug}`,
    );
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(page).toHaveURL(`${server.origin}${server.boardPath}`);
    await expect(page.getByRole('heading', { name: /Обновлённый проект/u })).toBeVisible();
    await page.getByRole('link', { name: 'Редактировать проект', exact: true }).click();
    await expect(page.getByLabel('Описание проекта', { exact: true })).toHaveValue(
      '## Точный исходник\n\nОписание проекта.',
    );
    await expect(page.getByLabel('Приоритет проекта', { exact: true })).toHaveValue('7');
  } finally {
    await page.context().close();
    await server.close();
  }
});
