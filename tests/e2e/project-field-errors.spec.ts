import { expect, test } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';

test('a rejected project emoji names and marks the emoji field', async ({ page }) => {
  const server = await projectBoardServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}${server.boardPath}`);
    await page.getByRole('link', { name: 'Редактировать проект', exact: true }).click();
    const emoji = page.getByLabel('Эмодзи проекта', { exact: true });
    await emoji.fill('ab');
    const rejected = page.waitForResponse(
      (response) => response.request().method() === 'PATCH' && response.status() === 400,
    );
    await page.getByRole('button', { name: /^Сохранить/u }).click();
    await rejected;
    await expect(page.getByRole('alert').filter({ hasText: '«Эмодзи»' })).toContainText(
      'Нужен ровно один эмодзи',
    );
    await expect(emoji).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Название проекта', { exact: true })).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // Editing clears the mark from the rejected save.
    await emoji.fill('🧪');
    await expect(emoji).not.toHaveAttribute('aria-invalid', 'true');
  } finally {
    await page.context().close();
    await server.close();
  }
});
