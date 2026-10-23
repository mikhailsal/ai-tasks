import { expect, test } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';

for (const creating of [false, true]) {
  test(`dirty project ${creating ? 'creation' : 'editing'} confirms closing without writes`, async ({
    page,
  }) => {
    const server = await projectBoardServer();
    try {
      await page.goto(`${server.origin}${creating ? '/projects' : '/projects/board-review'}`);
      if (creating) await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
      else await page.getByRole('button', { name: 'Редактировать проект', exact: true }).click();
      const name = page.getByLabel('Название проекта', { exact: true });
      await expect(name).toBeVisible();
      await name.fill('Несохранённый проект');
      const before = server.snapshot();
      const rejected = page.waitForEvent('dialog');
      const closing = page.getByRole('button', { name: 'Отмена', exact: true }).click();
      expect((await rejected).message()).toContain('несохранённые');
      await (await rejected).dismiss();
      await closing;
      await expect(name).toHaveValue('Несохранённый проект');
      const accepted = page.waitForEvent('dialog');
      const closingAgain = page.getByRole('button', { name: 'Отмена', exact: true }).click();
      await (await accepted).accept();
      await closingAgain;
      await expect(name).not.toBeVisible();
      expect(server.snapshot()).toEqual(before);
    } finally {
      await page.context().close();
      await server.close();
    }
  });
}

test('task reload confirms and recovers draft; explicit discard clears the warning', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    const id = server.ids[0];
    if (!id) throw new Error('Missing task fixture');
    await page.goto(`${server.origin}/projects/board-review/tasks/${id}`);
    const description = page.getByLabel('Описание', { exact: true });
    await description.click();
    await description.fill('Черновик после перезагрузки');
    const before = server.snapshot();
    const rejected = page.waitForEvent('dialog');
    const reload = page.evaluate(() => {
      window.location.reload();
    });
    const dialog = await rejected;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    await reload;
    await expect(description).toHaveValue('Черновик после перезагрузки');
    const accepted = page.waitForEvent('dialog');
    const reloadAgain = page.reload();
    await (await accepted).accept();
    await reloadAgain;
    await expect(description).toHaveValue('Черновик после перезагрузки');
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    const dialogs: string[] = [];
    page.on('dialog', async (event) => {
      dialogs.push(event.type());
      await event.dismiss();
    });
    await page.getByRole('link', { name: 'Назад на доску проекта', exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}${server.boardPath}`);
    expect(dialogs).toEqual([]);
    expect(server.snapshot()).toEqual(before);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('untouched creation and successfully saved task leave without false confirmations', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.goto(`${server.origin}/projects`);
    await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
    await expect(page.getByLabel('Название проекта', { exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.getByLabel('Название проекта', { exact: true })).not.toBeVisible();
    await page.goto(`${server.origin}/projects/board-review/tasks/new`);
    await expect(page.getByLabel('Название задачи', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Назад на доску проекта', exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}${server.boardPath}`);
    await page.goto(`${server.origin}/projects/board-review/tasks/new`);
    await page.getByLabel('Название задачи', { exact: true }).fill('Сохранённая новая задача');
    await page.getByLabel('Описание', { exact: true }).fill('Точный текст');
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/tasks'),
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect((await saved).status()).toBe(201);
    await expect(page).not.toHaveURL(/\/tasks\/new/u);
    await page.getByRole('link', { name: 'Назад на доску проекта', exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}${server.boardPath}`);
    expect(dialogs).toEqual([]);
  } finally {
    await page.context().close();
    await server.close();
  }
});
