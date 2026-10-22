import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod/mini';
import { backupValidation, successfulRecovery } from '../fixtures/recovery-transport.js';
import {
  cachedSource,
  cachedTitle,
  loadedTask,
  offlineBrowserServer,
  taskPath,
} from '../fixtures/offline-browser.js';

// Existing behavioral suites exercise these commands; this inventory adds geometry,
// Russian accessible controls, keyboard reachability and wrapping for every family.
const operationInventory = [
  'project.list/create/get/update/archive/restore',
  'task.list/create/get/update/transition/archive/restore',
  'description.preview',
  'dependency.list/add/remove',
  'configuration.read/presets/preview/migrate',
  'recurrence.read/configure/control/tick',
  'occurrence.list/get/complete/cancel',
  'agenda/priorities/statistics',
  'audit.list/filter/page',
  'settings.get/update',
  'backup.list/create/validate/restore/status',
];
const geometry = z.object({
  viewport: z.number(),
  root: z.object({ x: z.number(), width: z.number() }),
  overflow: z.boolean(),
  small: z.array(z.object({ label: z.string(), width: z.number(), height: z.number() })),
});
async function checkMobile(page: Page) {
  for (const width of [320, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const measured = geometry.parse(
      await page.evaluate(`(()=>{
      const root=document.querySelector('#root');if(!root)throw new Error('Missing application root');
      const bounds=root.getBoundingClientRect();
      const targets=[...document.querySelectorAll('main button,main a[href],main input:not([type="hidden"]),main select,main textarea,main summary')]
        .map(node=>node.matches('input[type="checkbox"],input[type="radio"]')?node.closest('label')??node:node)
        .filter(node=>node.getClientRects().length>0);
      return {viewport:innerWidth,root:{x:bounds.x,width:bounds.width},
        overflow:document.documentElement.scrollWidth>innerWidth,
        small:targets.map(node=>{const box=node.getBoundingClientRect();return {label:node.getAttribute('aria-label')??node.textContent?.trim().slice(0,70)??node.tagName,width:box.width,height:box.height};})
          .filter(box=>box.width<44||box.height<44)};})()`),
    );
    expect(measured.root.width).toBeLessThanOrEqual(430);
    expect(measured.root.x).toBeCloseTo((measured.viewport - measured.root.width) / 2, 0);
    let overflowDetails = '';
    if (measured.overflow) {
      const overflowing: unknown = await page.evaluate(() => {
        return [...document.querySelectorAll('main *')]
          .map((element) => ({
            tag: element.tagName,
            label: element.getAttribute('aria-label') ?? element.textContent?.slice(0, 100),
            right: element.getBoundingClientRect().right,
            width: element.getBoundingClientRect().width,
            parentWidth: element.parentElement?.getBoundingClientRect().width,
          }))
          .filter((element) => element.right > innerWidth)
          .slice(0, 20);
      });
      overflowDetails = JSON.stringify({ width, overflowing });
    }
    expect(measured.overflow, overflowDetails).toBe(false);
    expect(measured.small).toEqual([]);
  }
}

test.describe('independent mobile read and operation screens', () => {
  let server: Awaited<ReturnType<typeof offlineBrowserServer>>;
  test.beforeAll(async () => {
    server = await offlineBrowserServer();
  });
  test.afterAll(async () => {
    await server?.close();
  });
  test.beforeEach(() => {
    for (const operation of operationInventory)
      test.info().annotations.push({ type: 'UI operation', description: operation });
  });
  test.afterEach(async ({ page }) => {
    await page.close();
  });

  for (const view of [
    { path: '/projects', heading: 'Проекты' },
    { path: '/agenda?all_projects=true', heading: 'План' },
    { path: '/priorities?all_projects=true', heading: 'Приоритеты' },
    { path: '/workload?all_projects=true', heading: 'Нагрузка' },
    { path: '/audit?project_slug=alpha', heading: 'История изменений' },
    { path: '/settings?project_slug=alpha', heading: 'Настройки приложения' },
    { path: '/backups?project_slug=alpha', heading: 'Резервные копии' },
  ]) {
    test(`read screen ${view.heading} retains centered geometry, context and touch targets`, async ({
      page,
    }) => {
      await page.goto(`${server.origin}${view.path}`);
      await expect(
        page.getByRole('heading', { name: view.heading, exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Основная навигация', exact: true }),
      ).toBeVisible();
      await checkMobile(page);
    });
  }

  const operationViews = [
    {
      name: 'active project',
      path: () => '/projects/alpha',
      buttons: ['Редактировать проект', 'Архивировать проект'],
    },
    { name: 'archived project', path: () => '/projects/archived', buttons: ['Восстановить'] },
    {
      name: 'new task',
      path: () => '/projects/alpha/tasks/new',
      buttons: ['Сохранить', 'Предпросмотр'],
    },
    {
      name: 'dependencies',
      path: () => taskPath(server.dependentId),
      buttons: ['Добавить зависимость', 'Удалить зависимость'],
    },
    { name: 'archived task', path: () => taskPath(server.archivedId), buttons: ['Восстановить'] },
    {
      name: 'configuration',
      path: () => '/projects/alpha/configuration',
      buttons: ['Предпросмотр изменений', 'Применить изменения'],
    },
    {
      name: 'recurring task',
      path: () => taskPath(server.recurringId),
      buttons: [
        'Обработать наступившие сроки',
        'Изменить повторение',
        'Выполнить выбранные',
        'Отменить выбранные',
      ],
    },
  ];
  for (const view of operationViews) {
    test(`${view.name} operation controls remain accessible within the mobile column`, async ({
      page,
    }) => {
      await page.goto(`${server.origin}${view.path()}`);
      for (const name of view.buttons)
        await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
      await checkMobile(page);
    });
  }

  test('project creation controls remain accessible at every column width', async ({ page }) => {
    await page.goto(`${server.origin}/projects`);
    await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
    await expect(page.getByLabel('Название проекта', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить проект', exact: true })).toBeVisible();
    await checkMobile(page);
  });

  test('project editing controls remain accessible at every column width', async ({ page }) => {
    await page.goto(`${server.origin}/projects/alpha`);
    await page.getByRole('button', { name: 'Редактировать проект', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Сохранить изменения', exact: true }),
    ).toBeVisible();
    await checkMobile(page);
  });
});

test('keyboard editing and long hostile Markdown remain usable and safe at 320px without replacing exact source', async ({
  page,
}) => {
  const server = await offlineBrowserServer();
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    await loadedTask(page, server);
    await page.getByText('Исходник Markdown', { exact: true }).click();
    expect(
      await page
        .getByText('Исходник Markdown', { exact: true })
        .locator('..')
        .locator('pre')
        .textContent(),
    ).toBe(cachedSource);
    const rendered = page.getByRole('region', { name: 'Описание задачи', exact: true });
    await expect(rendered.locator('script,img,[onerror],a[href^="javascript:"]')).toHaveCount(0);
    await checkMobile(page);
    const edit = page.getByRole('button', { name: 'Редактировать', exact: true });
    await edit.focus();
    await expect(edit).toBeFocused();
    await page.keyboard.press('Enter');
    const title = page.getByLabel('Название задачи', { exact: true });
    await title.focus();
    await expect(title).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' — клавиатура');
    await expect(title).toHaveValue(`${cachedTitle} — клавиатура`);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Эмодзи задачи', { exact: true })).toBeFocused();
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(cachedSource);
    await checkMobile(page);
    const body: unknown = await page.evaluate('document.body.innerText');
    expect(z.string().parse(body)).not.toMatch(/Submit|Loading|Save changes|Unknown error/u);
  } finally {
    await page.close();
    await server.close();
  }
});

test('backup validation and explicit restore confirmation expose the complete project union without overflowing the column', async ({
  page,
}) => {
  const server = await offlineBrowserServer();
  try {
    const result = await server.request('http', {
      command: [],
      path: '/projects/alpha/backups',
      method: 'POST',
      input: server.envelope(),
    });
    expect(result.status).toBe(201);
    const backup = z.object({ id: z.uuid() }).parse(successfulRecovery(result));
    const validated = await server.request('http', {
      command: [],
      path: `/backups/${backup.id}/validate`,
      method: 'POST',
      input: { all_projects: true },
    });
    expect(validated.status).toBe(200);
    const union = backupValidation
      .parse(successfulRecovery(validated))
      .affected_projects.map((project) => project.project_slug);
    await page.goto(`${server.origin}/backups?project_slug=alpha`);
    const card = page.getByRole('region', { name: `Резервная копия ${backup.id}`, exact: true });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Проверить снимок', exact: true }).click();
    await expect(card).toContainText('Проверка пройдена');
    await card.getByRole('button', { name: 'Восстановить снимок', exact: true }).click();
    const review = page.getByRole('region', { name: 'Подтверждение восстановления', exact: true });
    for (const slug of union) await expect(review).toContainText(slug);
    await expect(review.getByLabel('Текст подтверждения', { exact: true })).toBeVisible();
    await expect(
      review.getByRole('button', { name: 'Подтвердить восстановление', exact: true }),
    ).toBeDisabled();
    await checkMobile(page);
  } finally {
    await page.close();
    await server.close();
  }
});
