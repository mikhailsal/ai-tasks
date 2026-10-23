import { expect, test } from '@playwright/test';
import { boardProject, projectBoardServer } from '../fixtures/project-board.js';
import {
  mobileMarkdown,
  mobileProject,
  mobileTitle,
  mobileUxServer,
} from '../fixtures/mobile-ux.js';
import { closeTaskActions, openTaskActions, openTaskFormatting } from '../fixtures/task-ui.js';

test('home selects a project and opens its Kanban directly', async ({ page }) => {
  const server = await mobileUxServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}/`);
    await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
    await page.getByRole('link', { name: new RegExp(mobileProject.name, 'u') }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${mobileProject.slug}/board`, 'u'));
    await expect(page.getByRole('button', { name: 'Обычные', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повторяющиеся', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Поиск задач', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Фильтры задач', exact: true })).toBeVisible();
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('task opens directly editable with discoverable actual history', async ({ page }) => {
  const server = await mobileUxServer();
  try {
    await page.goto(`${server.origin}${server.taskPath}`);
    await expect(page.getByLabel('Название задачи', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Название задачи', { exact: true })).toHaveValue(mobileTitle);
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'История изменений', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(mobileMarkdown);
    await expect(page.getByRole('button', { name: 'Предпросмотр', exact: true })).not.toBeVisible();
    await openTaskFormatting(page);
    await expect(page.getByRole('button', { name: 'Предпросмотр', exact: true })).toBeVisible();
    await page.getByText('Дополнительно', { exact: true }).click();
    const actions = await openTaskActions(page);
    await expect(actions.getByRole('button', { name: 'В архив', exact: true })).toBeEnabled();
    await closeTaskActions(page);
    await expect(page.getByLabel('Название задачи', { exact: true })).toBeVisible();
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('board searches and filters every page and restores kind and detail context', async ({
  page,
}) => {
  const server = await projectBoardServer(true);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}${server.boardPath}`);
    const ideas = page.locator('.board-column[data-status-id="ideas"]');
    await expect(ideas.locator('.board-task')).toHaveCount(30);
    await expect(ideas).not.toContainText('Найти на всех страницах');
    await page.getByRole('button', { name: 'Поиск задач', exact: true }).click();
    await page
      .getByRole('searchbox', { name: 'Поиск задач в проекте', exact: true })
      .fill('Safari');
    const results = page.getByRole('region', { name: 'Результаты поиска', exact: true });
    await expect(results.locator('.board-task')).toHaveCount(1);
    await expect(results).toContainText('Найти на всех страницах');
    await expect(results).toContainText('Заблокирована');
    await expect(results).toContainText('Идеи');
    await results
      .getByRole('link', { name: /Найти на всех страницах/u })
      .first()
      .click();
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
      'Описание с уникальным словом Safari',
    );
    await page.getByRole('link', { name: /Назад на доску/u }).click();
    await expect(
      page.getByRole('searchbox', { name: 'Поиск задач в проекте', exact: true }),
    ).toHaveValue('Safari');
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('button', { name: 'Фильтры задач', exact: true }).click();
    const filters = page.getByRole('dialog', { name: 'Фильтры задач', exact: true });
    await filters.getByRole('button', { name: 'Высокий', exact: true }).click();
    await filters.getByRole('button', { name: 'Сегодня', exact: true }).click();
    await filters.getByRole('button', { name: 'Показать задачи', exact: true }).click();
    await expect(ideas.locator('.board-task')).toHaveCount(1);
    await expect(ideas).toContainText('Найти на всех страницах');
    await expect(page.locator('.board-filter-summary')).toContainText('Высокий');
    await expect(ideas.locator('.board-drag-handle')).toBeDisabled();
    await page.getByRole('button', { name: 'Повторяющиеся', exact: true }).click();
    await expect(page.locator(`.board-task[data-task-id="${server.recurringId}"]`)).toBeVisible();
    await expect(page.locator('.board-filter-summary')).toHaveCount(0);
    await page.getByRole('button', { name: 'Обычные', exact: true }).click();
    await expect(page.locator('.board-filter-summary')).toContainText('Высокий');
    await page.getByRole('button', { name: 'Фильтры задач', exact: true }).click();
    await filters.getByRole('button', { name: 'Низкий', exact: true }).click();
    await page.mouse.click(2, 2);
    await expect(filters).not.toBeVisible();
    await expect(page.locator('.board-filter-summary')).toContainText('Высокий');
    await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
    await expect(ideas.locator('.board-task')).toHaveCount(30);
    await page.getByRole('button', { name: 'Добавить задачу', exact: true }).click();
    await expect(page.getByLabel('Тип задачи', { exact: true })).toHaveValue('ordinary');
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('pointer drag persists ordering and stage changes for a fresh browser context', async ({
  page,
  browser,
}) => {
  const server = await projectBoardServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}${server.boardPath}`);
    const source = page.locator('.board-column[data-status-id="ideas"]');
    const cards = source.locator('.board-task');
    await expect(cards).toHaveCount(server.ids.length);
    const firstId = server.ids[0];
    if (!firstId) throw Error('Missing first fixture task');
    await expect(cards.first().locator('.board-drag-handle')).toBeEnabled();
    const handle = await cards.first().locator('.board-drag-handle').boundingBox(),
      second = await cards.nth(1).boundingBox();
    if (!handle || !second) throw Error('Missing draggable geometry');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(190, second.y + second.height - 3, { steps: 12 });
    const moved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/position'),
    );
    await page.mouse.up();
    expect((await moved).status()).toBe(200);
    await expect(cards.nth(1)).toHaveAttribute('data-task-id', firstId);
    await page.reload();
    await expect(cards.nth(1)).toHaveAttribute('data-task-id', firstId);
    await expect(cards.nth(1).locator('.board-drag-handle')).toBeEnabled();
    const h = await cards.nth(1).locator('.board-drag-handle').boundingBox();
    if (!h) throw Error('Missing persisted card');
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(380, 360, { steps: 12 });
    await expect(page.locator('.board-stage-tabs button[aria-pressed="true"]')).toHaveText(
      'Планирование',
    );
    await page.mouse.move(200, 350, { steps: 5 });
    const transferred = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/position'),
    );
    await page.mouse.up();
    expect((await transferred).status()).toBe(200);
    await expect(
      page.locator(`.board-column[data-status-id="plan"] .board-task[data-task-id="${firstId}"]`),
    ).toBeVisible();
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const other = await fresh.newPage();
      await other.goto(`${server.origin}${server.boardPath}`);
      await other
        .getByRole('navigation', { name: 'Стадии проекта', exact: true })
        .getByRole('button', { name: 'Планирование', exact: true })
        .click();
      await expect(
        other.locator(
          `.board-column[data-status-id="plan"] .board-task[data-task-id="${firstId}"]`,
        ),
      ).toBeVisible();
      await expect(
        other.locator(
          `.board-column[data-status-id="ideas"] .board-task[data-task-id="${firstId}"]`,
        ),
      ).toHaveCount(0);
    } finally {
      await fresh.close();
    }
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('project title opens editing and direct task save refreshes board with real history', async ({
  page,
}) => {
  const server = await projectBoardServer();
  try {
    await page.goto(`${server.origin}${server.boardPath}`);
    await page.getByRole('link', { name: 'Редактировать проект', exact: true }).click();
    await expect(page.getByLabel('Название проекта', { exact: true })).toHaveValue(
      boardProject.name,
    );
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${boardProject.slug}/board`, 'u'));
    const first = page.locator('.board-column[data-status-id="ideas"] .board-task').first();
    await first.locator('.board-task-title').click();
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeInViewport();
    await page.getByLabel('Название задачи', { exact: true }).fill('Изменённое название на доске');
    const save = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes('/tasks/'),
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect((await save).status()).toBe(200);
    const history = page.getByRole('region', { name: 'История изменений задачи', exact: true });
    await expect(history).toContainText('Изменённое название на доске');
    await page.getByRole('link', { name: /Назад на доску/u }).click();
    await expect(
      page.locator('.board-task-title').filter({ hasText: 'Изменённое название на доске' }),
    ).toBeVisible();
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('real touch separates column swipes, vertical scrolling and deliberate card drag', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Chromium exposes actual touch input; WebKit pointer and layout journeys run separately.',
  );
  const server = await projectBoardServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(server.origin + server.boardPath);
    const source = page.locator('.board-column[data-status-id="ideas"]');
    const list = source.locator('.board-cards');
    await expect(source.locator('.board-task')).toHaveCount(server.ids.length);
    const cdp = await context.newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
      });
    const box = await list.boundingBox();
    if (!box) throw Error('Missing column geometry');
    const middle = box.x + box.width / 2,
      start = box.y + box.height - 60,
      end = box.y + 60;
    await touch('touchStart', middle, start);
    for (let i = 1; i <= 16; i++) {
      await touch('touchMove', middle, start + ((end - start) * i) / 16);
      await page.waitForTimeout(20);
    }
    await touch('touchEnd');
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await expect(page.locator('.board-stage-tabs button[aria-pressed="true"]')).toHaveText('Идеи');
    const before = await server.snapshot();
    const track = await page.locator('.board-track').boundingBox();
    if (!track) throw Error('Missing board track');
    await touch('touchStart', track.x + track.width - 45, track.y + 25);
    for (let i = 1; i <= 20; i++) {
      await touch(
        'touchMove',
        track.x + track.width - 45 - ((track.width - 90) * i) / 20,
        track.y + 25,
      );
      await page.waitForTimeout(25);
    }
    await touch('touchEnd');
    await expect(page.locator('.board-stage-tabs button[aria-pressed="true"]')).toHaveText(
      'Планирование',
    );
    expect(await server.snapshot()).toEqual(before);
    await page
      .getByRole('navigation', { name: 'Стадии проекта', exact: true })
      .getByRole('button', { name: 'Идеи', exact: true })
      .click();
    await list.evaluate((el) => (el.scrollTop = 0));
    const cards = source.locator('.board-task');
    await expect(cards.first().locator('.board-drag-handle')).toBeEnabled();
    const h = await cards.first().locator('.board-drag-handle').boundingBox(),
      second = await cards.nth(1).boundingBox();
    if (!h || !second) throw Error('Missing touch card');
    await touch('touchStart', h.x + h.width / 2, h.y + h.height / 2);
    await expect(page.locator('.board-drag-ghost')).toBeVisible();
    await touch('touchMove', 190, second.y + second.height - 3);
    const response = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/position'),
    );
    await touch('touchEnd');
    expect((await response).status()).toBe(200);
    await expect(cards.nth(1)).toHaveAttribute('data-task-id', server.ids[0] ?? 'missing');
  } finally {
    await page.context().close();
    await server.close();
  }
});
