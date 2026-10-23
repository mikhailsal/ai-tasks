import { expect, test } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';
import { openTaskActions } from '../fixtures/task-ui.js';

test('task detail follows the simple sketch while retaining advanced formatting controls', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    const id = server.ids[0];
    if (!id) throw new Error('Missing task fixture');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}/projects/board-review/tasks/${id}`);
    await expect(page.getByLabel('Название задачи', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Описание', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Предпросмотр', exact: true })).not.toBeVisible();
    await expect(page.getByText('Markdown', { exact: true })).not.toBeVisible();
    await expect(page.getByLabel('Приоритет', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Действия с задачей', exact: true }),
    ).toBeVisible();
    const history = page.getByRole('region', { name: 'История изменений задачи', exact: true });
    await expect(
      history.getByRole('heading', { name: 'История изменений', exact: true }),
    ).toBeInViewport();
    await expect(history.locator('.task-history-meta > p')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeInViewport();
    await page.getByText('Дополнительно', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Предпросмотр', exact: true })).toBeVisible();
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('simple task editing preserves existing source exactly and Cancel discards only local changes', async ({
  page,
}) => {
  const server = await projectBoardServer();
  const source = '  Обычный текст\n\n# Сохранённый заголовок\n\n**Сохранить знаки и пробелы**  \n';
  try {
    const id = server.ids[0];
    if (!id) throw new Error('Missing task fixture');
    const seeded = await page.request.patch(
      `${server.origin}/api/v1/projects/board-review/tasks/${id}`,
      {
        headers: { Origin: server.origin, 'X-AI-Tasks-Mutation': '1' },
        data: server.envelope({ description: source }, { expected_revision: 1 }),
      },
    );
    expect(seeded.status()).toBe(200);
    await page.goto(`${server.origin}/projects/board-review/tasks/${id}`);
    const description = page.getByLabel('Описание', { exact: true });
    await expect(description).toHaveValue(source);
    await description.fill(`${source}\nНесохранённая правка`);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(description).toHaveValue(source);
    await page.reload();
    await expect(description).toHaveValue(source);
    const proposed = `${source}\nЯвно сохранённая правка`;
    await description.fill(proposed);
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().endsWith(`/tasks/${id}`),
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect(description).toHaveValue(proposed);
  } finally {
    await page.context().close();
    await server.close();
  }
});

for (const dismissal of ['Escape', 'Отмена', 'outside'] as const) {
  test(`dismissing nested transition consent with ${dismissal} cancels only that dialog and never writes`, async ({
    page,
  }) => {
    const server = await projectBoardServer();
    try {
      const id = server.ids[0];
      if (!id) throw new Error('Missing task fixture');
      for (const [index, status] of ['plan', 'work', 'test', 'review'].entries()) {
        const seeded = await page.request.post(
          `${server.origin}/api/v1/projects/board-review/tasks/${id}/transitions`,
          {
            headers: { Origin: server.origin, 'X-AI-Tasks-Mutation': '1' },
            data: server.envelope({ to_status_id: status }, { expected_revision: index + 1 }),
          },
        );
        expect(seeded.status()).toBe(200);
      }
      await page.goto(`${server.origin}/projects/board-review/tasks/${id}`);
      const draft = 'Мой несохранённый текст **целиком**';
      await page.getByLabel('Описание', { exact: true }).fill(draft);
      const before = await server.snapshot();
      const writes: string[] = [];
      page.on('request', (request) => {
        if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/v1/'))
          writes.push(request.url());
      });
      await openTaskActions(page);
      await page.getByRole('button', { name: 'Завершить: Готово', exact: true }).click();
      const consent = page.getByRole('dialog', { name: 'Подтвердите переход', exact: true });
      await consent
        .getByLabel('Текст подтверждения', { exact: true })
        .fill('Не отправлять согласие');
      if (dismissal === 'Escape') await page.keyboard.press('Escape');
      else if (dismissal === 'outside') await page.mouse.click(2, 2);
      else await consent.getByRole('button', { name: 'Отмена', exact: true }).click();
      await expect(consent).not.toBeVisible();
      const actions = page.getByRole('dialog', { name: 'Действия с задачей', exact: true });
      await expect(actions).toBeVisible();
      await actions.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(draft);
      expect(writes).toEqual([]);
      expect(await server.snapshot()).toEqual(before);
    } finally {
      await page.context().close();
      await server.close();
    }
  });
}
