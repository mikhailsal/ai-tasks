import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/mini';
import { projectBoardServer } from '../fixtures/project-board.js';

test('long task descriptions grow on load, edit and viewport resize', async ({ page }, info) => {
  const server = await projectBoardServer();
  const id = server.ids[0];
  if (!id) throw new Error('Missing task fixture');
  const source = `${'Точный исходный текст с переносом строки.\n'.repeat(24)}Конец.`;
  try {
    const seeded = await page.request.patch(
      `${server.origin}/api/v1/projects/board-review/tasks/${id}`,
      {
        headers: { Origin: server.origin, 'X-AI-Tasks-Mutation': '1' },
        data: server.envelope({ description: source }, { expected_revision: 1 }),
      },
    );
    expect(seeded.status()).toBe(200);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}/projects/board-review/tasks/${id}`);
    const description = page.getByLabel('Описание', { exact: true });
    await expect(description).toHaveValue(source);
    await page.screenshot({
      path: `artifacts/mobile-ux/editor-followup-long-${info.project.name}-390.png`,
      fullPage: true,
    });
    const initialHeight = await description.evaluate((element) => element.clientHeight);
    await expect
      .poll(() => description.evaluate((element) => element.scrollHeight))
      .toBeLessThanOrEqual(initialHeight + 1);
    await description.fill(`${source}\nДобавлено точно.`);
    await expect(description).toHaveValue(`${source}\nДобавлено точно.`);
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(description).toHaveValue(`${source}\nДобавлено точно.`);
    await expect
      .poll(() => description.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `artifacts/mobile-ux/editor-followup-long-${info.project.name}-320.png`,
      fullPage: true,
    });
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('project emoji is visible beside the name in create and edit forms', async ({ page }) => {
  const server = await projectBoardServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}/projects/board-review/board?kind=ordinary`);
    await page.getByRole('link', { name: 'Редактировать проект', exact: true }).click();
    const editName = page.getByLabel('Название проекта', { exact: true });
    const editEmoji = page.getByLabel('Эмодзи проекта', { exact: true });
    await expect(editEmoji).toBeVisible();
    await expect(editEmoji).toHaveValue('🚀');
    const editNameBox = await editName.boundingBox();
    const editEmojiBox = await editEmoji.boundingBox();
    if (!editNameBox || !editEmojiBox) throw new Error('Missing project identity fields');
    expect(editEmojiBox.y).toBeGreaterThanOrEqual(editNameBox.y);
    await page.goto(`${server.origin}/projects`);
    await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
    await expect(page.getByLabel('Название проекта', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Эмодзи проекта', { exact: true })).toBeVisible();
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('expanded Eisenhower and deadline controls stay in normal flow on narrow screens', async ({
  page,
}, info) => {
  const server = await projectBoardServer();
  try {
    await page.goto(`${server.origin}${server.boardPath}`);
    const slug = `editor-layout-${randomUUID().slice(0, 8)}`;
    const config = {
      priority_model: { type: 'eisenhower' },
      ordinary_workflow: {
        initial_status_id: 'queued',
        statuses: [
          { id: 'queued', label: 'Очередь', category: 'not_started' },
          { id: 'doing', label: 'Работа', category: 'in_progress' },
          { id: 'finished', label: 'Готово', category: 'completed' },
        ],
        transitions: [
          { from: 'queued', to: 'doing', requires_confirmation: false },
          { from: 'doing', to: 'finished', requires_confirmation: true },
          { from: 'finished', to: 'doing', requires_confirmation: false },
        ],
      },
      recurring_workflow: {
        initial_status_id: 'draft',
        restore_status_id: 'paused',
        statuses: [
          { id: 'draft', label: 'Черновик', category: 'draft' },
          { id: 'active', label: 'Активно', category: 'active' },
          { id: 'paused', label: 'Пауза', category: 'paused' },
          { id: 'archived', label: 'Архив', category: 'archived' },
        ],
        transitions: [
          { from: 'draft', to: 'active', requires_confirmation: false },
          { from: 'active', to: 'paused', requires_confirmation: false },
          { from: 'paused', to: 'active', requires_confirmation: false },
          { from: 'draft', to: 'archived', requires_confirmation: false },
          { from: 'active', to: 'archived', requires_confirmation: false },
          { from: 'paused', to: 'archived', requires_confirmation: false },
          { from: 'archived', to: 'paused', requires_confirmation: false },
        ],
      },
    };
    const headers = { Origin: server.origin, 'X-AI-Tasks-Mutation': '1' };
    const createdProject = await page.request.post(`${server.origin}/api/v1/projects/${slug}`, {
      headers,
      data: server.envelope({ slug, name: 'Проверка размещения', emoji: '🧭', config }),
    });
    expect(createdProject.status()).toBe(201);
    const createdTask = await page.request.post(`${server.origin}/api/v1/projects/${slug}/tasks`, {
      headers,
      data: server.envelope(
        { kind: 'ordinary', title: 'Проверка', description: '' },
        { expected_config_revision: 1 },
      ),
    });
    expect(createdTask.status()).toBe(201);
    const taskId = z.object({ data: z.object({ id: z.uuid() }) }).parse(await createdTask.json())
      .data.id;
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${server.origin}/projects/${slug}/tasks/${taskId}`);
      await page.getByRole('button', { name: 'Сохранить', exact: true }).waitFor();
      await page.getByLabel('Указать приоритет', { exact: true }).check();
      const checkbox = page.getByLabel('Важно', { exact: true });
      const checkboxRow = page.locator('.task-priority-control .field').filter({ has: checkbox });
      const checkboxBox = await checkboxRow.boundingBox();
      if (!checkboxBox) throw new Error('Missing Eisenhower checkbox');
      expect(checkboxBox.width).toBeGreaterThanOrEqual(44);
      expect(checkboxBox.height).toBeGreaterThanOrEqual(44);
      const labelBox = await checkboxRow.locator('label').boundingBox();
      if (!labelBox) throw new Error('Missing Eisenhower checkbox label');
      expect(labelBox.width).toBeGreaterThanOrEqual(44);
      expect(labelBox.height).toBeGreaterThanOrEqual(44);
      const visual = await checkbox.boundingBox();
      if (!visual) throw new Error('Missing Eisenhower checkbox input');
      expect(visual.width).toBeGreaterThanOrEqual(16);
      expect(visual.width).toBeLessThanOrEqual(20);
      expect(visual.height).toBeGreaterThanOrEqual(16);
      expect(visual.height).toBeLessThanOrEqual(20);
      await page.locator('.task-deadline-control details > summary').click();
      const deadline = page.locator('.task-deadline-control fieldset');
      await expect(deadline).toBeVisible();
      const deadlineBox = await deadline.boundingBox();
      if (!deadlineBox) throw new Error('Missing expanded deadline fieldset');
      expect(deadlineBox.x).toBeGreaterThanOrEqual(0);
      expect(deadlineBox.x + deadlineBox.width).toBeLessThanOrEqual(width + 1);
      const eisenhowerBox = await page.locator('.task-priority-control fieldset').boundingBox();
      if (!eisenhowerBox) throw new Error('Missing expanded Eisenhower fieldset');
      expect(eisenhowerBox.y + eisenhowerBox.height).toBeLessThanOrEqual(deadlineBox.y);
      expect(
        await page.locator('html').evaluate((element) => element.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `artifacts/mobile-ux/editor-followup-eisenhower-${info.project.name}-${width}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Отмена', exact: true }).click();
      await expect(page.getByLabel('Указать приоритет', { exact: true })).not.toBeChecked();
    }
  } finally {
    await page.context().close();
    await server.close();
  }
});
