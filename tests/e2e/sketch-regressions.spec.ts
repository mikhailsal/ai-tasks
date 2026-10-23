import { expect, test, type Page } from '@playwright/test';
import { projectBoardServer } from '../fixtures/project-board.js';

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: false,
  isMobile: false,
  serviceWorkers: 'block',
});

async function reorderFirst(page: Page) {
  const cards = page.locator('.board-column[data-status-id="ideas"] .board-task');
  await expect(cards.first().locator('.board-drag-handle')).toBeEnabled();
  const handle = await cards.first().locator('.board-drag-handle').boundingBox();
  const second = await cards.nth(1).boundingBox();
  if (!handle || !second) throw Error('Missing drag geometry');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await expect(page.locator('.board-drag-ghost')).toBeVisible();
  await page.mouse.move(180, second.y + second.height - 2, { steps: 10 });
  await page.mouse.up();
}

test('application cards and project title retain sketch styling on hover', async ({ page }) => {
  const server = await projectBoardServer();
  try {
    await page.goto(server.origin);
    const project = page.locator('.project-card').first();
    await project.hover();
    await expect(project).toHaveCSS('text-decoration-line', 'none');
    await page.goto(server.origin + server.boardPath);
    for (const target of [
      page.locator('.board-project-title'),
      page.locator('.board-task-title').first(),
    ]) {
      await target.hover();
      await expect(target).toHaveCSS('text-decoration-line', 'none');
    }
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('project search hides its accessible label and fits the input and actions at 320px', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    await page.goto(server.origin + server.boardPath);
    await page.getByRole('button', { name: 'Поиск задач', exact: true }).click();
    const input = page.getByRole('searchbox', { name: 'Поиск задач в проекте', exact: true });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const label = await page.locator('label[for="project-task-search"]').boundingBox();
      expect(label?.width).toBeLessThanOrEqual(1);
      expect(label?.height).toBeLessThanOrEqual(1);
      const field = await input.boundingBox();
      expect(field?.width).toBeGreaterThanOrEqual(120);
      await expect(
        page.getByRole('button', { name: 'Очистить поиск', exact: true }),
      ).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Отмена', exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('a preparation error can be closed without writing or changing task order', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    await page.addInitScript(() => {
      const nativeUuid = crypto.randomUUID.bind(crypto);
      let firstAttempt = true;
      Object.defineProperty(crypto, 'randomUUID', {
        value: () => {
          if (firstAttempt) {
            firstAttempt = false;
            throw Error('Не удалось подготовить перемещение');
          }
          return nativeUuid();
        },
      });
    });
    await page.goto(server.origin + server.boardPath);
    const before = server.snapshot();
    await reorderFirst(page);
    await expect(page.locator('.board-error[role="alert"]')).toContainText(
      'Не удалось подготовить перемещение',
    );
    await page.getByRole('button', { name: 'Закрыть сообщение об ошибке', exact: true }).click();
    await expect(page.locator('.board-error[role="alert"]')).toHaveCount(0);
    expect(server.snapshot()).toEqual(before);
    const saved = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/position'),
    );
    await reorderFirst(page);
    expect((await saved).status()).toBe(200);
    const secondId = server.ids[1];
    if (!secondId) throw new Error('Missing second task');
    await expect(
      page.locator('.board-column[data-status-id="ideas"] .board-task').first(),
    ).toHaveAttribute('data-task-id', secondId);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('closing a network error retains the exact pending operation for explicit retry', async ({
  page,
}) => {
  const server = await projectBoardServer();
  const bodies: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/position'))
      bodies.push(request.postData() ?? '');
  });
  try {
    await page.route('**/position', (route) => route.abort('failed'));
    await page.goto(server.origin + server.boardPath);
    await reorderFirst(page);
    await expect(page.locator('.board-error[role="alert"]')).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть сообщение об ошибке', exact: true }).click();
    await expect(page.locator('.board-error[role="alert"]')).toHaveCount(0);
    expect(bodies).toHaveLength(1);
    await expect(
      page.getByRole('button', { name: 'Проверить результат перемещения', exact: true }),
    ).toBeVisible();
    await page.unroute('**/position');
    const retried = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/position'),
    );
    await page
      .getByRole('button', { name: 'Проверить результат перемещения', exact: true })
      .click();
    expect((await retried).status()).toBe(200);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('secondary pages offer Back with board context and a safe direct-entry fallback', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    const boardPath = `${server.boardPath}&q=Safari`;
    await page.goto(server.origin + boardPath);
    await page.getByRole('button', { name: 'Меню проекта', exact: true }).click();
    await page.getByRole('link', { name: /Настройки приложения/u }).click();
    await expect(
      page.getByRole('heading', { name: 'Настройки приложения', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(server.origin + boardPath);
    await page.goto(server.origin + '/audit');
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(server.origin + '/');
    await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  } finally {
    await page.context().close();
    await server.close();
  }
});
