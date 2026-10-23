import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod/mini';
import {
  agendaPageEnvelopeSchema,
  prioritiesPageEnvelopeSchema,
} from '../../src/schema/read-views.js';
import {
  mobileDeadline,
  mobileMarkdown,
  mobileProject,
  mobileTitle,
  mobileUxServer,
} from '../fixtures/mobile-ux.js';
import { offlineBrowserServer } from '../fixtures/offline-browser.js';

test('populated home exposes a project in the first 390×844 viewport', async ({ page }) => {
  const server = await offlineBrowserServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}/`);
    const first = page.locator('.project-card').first();
    await expect(first).toBeVisible();
    const box = await first.boundingBox();
    if (!box) throw new Error('Expected the first project card');
    expect(box.y).toBeGreaterThanOrEqual(0);
    await expect
      .poll(async () => {
        const bounds = await first.boundingBox();
        return bounds ? bounds.y + bounds.height : Infinity;
      })
      .toBeLessThanOrEqual(844);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('online saved-data status stays compact while retaining its saved timestamp', async ({
  page,
}) => {
  const server = await offlineBrowserServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}/`);
    await expect(page.locator('.project-card').first()).toBeVisible();
    const status = page.getByRole('complementary', { name: 'Соединение и сохранённые данные' });
    await expect(status.locator('time')).toBeVisible();
    await expect(status.locator('time')).toHaveAttribute('datetime', /\d{4}-\d{2}-\d{2}T/u);
    await expect
      .poll(async () => (await status.boundingBox())?.height ?? Infinity)
      .toBeLessThanOrEqual(90);
  } finally {
    await page.context().close();
    await server.close();
  }
});

const layoutSchema = z.object({
  width: z.number(),
  rootX: z.number(),
  rootWidth: z.number(),
  overflow: z.boolean(),
  small: z.array(z.string()),
  wrappedLabels: z.array(z.string()),
});

async function checkLayouts(page: Page) {
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = layoutSchema.parse(
      await page.evaluate(`(() => {
        const root = document.querySelector('#root');
        if (!root) throw new Error('Missing application root');
        const rect = root.getBoundingClientRect();
        const visible = node => node.getClientRects().length > 0;
        const controls = [...document.querySelectorAll('header button,header a[href],header summary,main button,main a[href],main input:not([type="hidden"]),main select,main textarea,main summary')]
          .map(node => node.matches('input[type="checkbox"],input[type="radio"]') ? node.closest('label') ?? node : node)
          .filter(visible);
        const small = controls.filter(node => {
          const box = node.getBoundingClientRect();
          return box.width < 43.9 || box.height < 43.9;
        }).map(node => node.getAttribute('aria-label') ?? node.textContent?.trim() ?? node.tagName);
        const wrappedLabels = [...document.querySelectorAll('header nav a,header nav summary,header nav button')]
          .filter(visible).filter(node => {
            const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            let current;
            while ((current = text.nextNode())) {
              if (!current.textContent?.trim() || current.parentElement?.closest('svg')) continue;
              const range = document.createRange(); range.selectNodeContents(current);
              if (new Set([...range.getClientRects()].map(box => Math.round(box.top))).size > 1) return true;
            }
            return false;
          }).map(node => node.textContent?.trim() ?? '');
        return { width: innerWidth, rootX: rect.x, rootWidth: rect.width,
          overflow: document.documentElement.scrollWidth > innerWidth, small, wrappedLabels };
      })()`),
    );
    expect(layout.rootWidth, `${width}px column`).toBeCloseTo(Math.min(width, 430), 0);
    expect(layout.rootX, `${width}px centered column`).toBeCloseTo(
      (layout.width - layout.rootWidth) / 2,
      0,
    );
    expect(layout.overflow, `${width}px horizontal overflow`).toBe(false);
    expect(layout.small, `${width}px touch targets below 44px`).toEqual([]);
    expect(layout.wrappedLabels, `${width}px navigation labels wrap`).toEqual([]);
  }
}

async function openMore(page: Page) {
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  await expect(more).toBeVisible();
  await more.click();
}

test('primary navigation retains focus, readable targets and cancellable More', async ({
  page,
}) => {
  const server = await mobileUxServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}/`);
    await expect(page.locator('.project-card').first()).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Перейти к содержимому', exact: true });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    for (const name of ['Обзор', 'Проекты'])
      await expect(
        page
          .getByRole('navigation', { name: 'Основная навигация', exact: true })
          .getByRole('link', { name, exact: true }),
      ).toBeVisible();
    await checkLayouts(page);
    await openMore(page);
    await checkLayouts(page);
    await page.mouse.click(2, 2);
    await expect(page.getByRole('dialog')).not.toBeVisible();
  } finally {
    await page.context().close();
    await server.close();
  }
});
for (const group of [
  [
    { name: 'План', path: '/agenda', heading: 'План' },
    { name: 'Приоритеты', path: '/priorities', heading: 'Приоритеты' },
    { name: 'Нагрузка', path: '/workload', heading: 'Нагрузка' },
  ],
  [
    { name: 'История', path: '/audit', heading: 'История изменений' },
    { name: 'Настройки приложения', path: '/settings', heading: 'Настройки приложения' },
    { name: 'Резервные копии', path: '/backups', heading: 'Резервные копии' },
  ],
])
  test(`More reaches ${group.map((item) => item.name).join(', ')}`, async ({ page }) => {
    const server = await mobileUxServer();
    try {
      await page.goto(`${server.origin}/`);
      for (const view of group) {
        await openMore(page);
        const destination = page.getByRole('link', { name: view.name, exact: true });
        await expect(destination).toBeVisible();
        await destination.click();
        await expect(page).toHaveURL(new RegExp(`${view.path}(?:\\?|$)`, 'u'));
        await expect(
          page.getByRole('heading', { name: view.heading, exact: true }).first(),
        ).toBeVisible();
      }
    } finally {
      await page.context().close();
      await server.close();
    }
  });

test('project selection opens contextual task board and adding retains explicit project', async ({
  page,
}) => {
  const server = await mobileUxServer();
  try {
    await page.goto(`${server.origin}/`);
    await page.getByRole('link', { name: new RegExp(mobileProject.name, 'u') }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${mobileProject.slug}/board`, 'u'));
    const card = page.locator('.board-task').filter({ hasText: mobileTitle });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Высокий/iu);
    await expect(card.locator(`time[datetime="${mobileDeadline}"]`)).toBeVisible();
    await expect(page.getByRole('main')).toContainText(mobileProject.name);
    await expect(card).not.toContainText(mobileProject.slug);
    await checkLayouts(page);
    await page.getByRole('button', { name: 'Добавить задачу', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${mobileProject.slug}/tasks/new\\?`, 'u'));
    await expect(page.getByLabel('Название задачи', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible();
    await checkLayouts(page);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('ordinary task actions precede long readable Markdown and use clear button hierarchy', async ({
  page,
}) => {
  const server = await mobileUxServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}${server.taskPath}`);
    await expect(page.getByRole('heading', { name: mobileTitle, exact: true })).toBeVisible();
    const actions = page.getByRole('region', { name: 'Действия с задачей', exact: true });
    const markdown = page.getByRole('region', { name: 'Описание задачи', exact: true });
    await expect(actions).toBeVisible();
    await expect(markdown).toHaveClass(/markdown/u);
    const actionsBox = await actions.boundingBox();
    const markdownBox = await markdown.boundingBox();
    if (!actionsBox || !markdownBox) throw new Error('Expected task actions and Markdown');
    expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(markdownBox.y);
    await expect(page.getByRole('button', { name: /^Скопировать эмодзи/u })).toHaveClass(
      /button-ghost/u,
    );
    await expect(actions.getByRole('button', { name: /архив/iu })).toHaveClass(/button-ghost/u);
    const cancellation = actions.getByRole('button', { name: /отмен/iu });
    await expect(cancellation).not.toHaveCount(0);
    for (const button of await cancellation.all())
      await expect(button).toHaveClass(/button-danger/u);
    await expect(markdown.getByRole('heading', { name: 'Порядок работы', level: 2 })).toBeVisible();
    await expect(markdown.locator('ul > li')).toHaveText([
      'Прочитать условия',
      'Проверить результат',
    ]);
    await expect(markdown.locator('p code')).toHaveText('готово');
    await expect(markdown.locator('pre code')).toContainText('длинная_строка_');
    const listStyle = await markdown
      .locator('ul')
      .evaluate((node) => getComputedStyle(node).listStyleType);
    expect(z.string().parse(listStyle)).not.toBe('none');
    await page.getByText('Исходник Markdown', { exact: true }).click();
    await expect(
      page.getByText('Исходник Markdown', { exact: true }).locator('..').locator('pre'),
    ).toHaveText(mobileMarkdown);
    await checkLayouts(page);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('cached mobile task preserves offline context and disabled actions without database writes', async ({
  page,
  context,
}) => {
  const server = await mobileUxServer();
  try {
    await page.goto(`${server.origin}${server.taskPath}`);
    await expect(page.getByRole('heading', { name: mobileTitle, exact: true })).toBeVisible();
    const status = page.getByRole('complementary', { name: 'Соединение и сохранённые данные' });
    await expect(status.locator('time')).toHaveAttribute('datetime', /\d{4}-\d{2}-\d{2}T/u);
    const saved = await status.locator('time').getAttribute('datetime');
    const before = await server.snapshot();
    await context.setOffline(true);
    await expect(status).toContainText(/Нет соединения/u);
    await expect(status.locator('time')).toBeVisible();
    await expect(status.locator('time')).toHaveAttribute('datetime', saved ?? '');
    await expect(page.getByRole('region', { name: 'Описание задачи', exact: true })).toContainText(
      'Порядок работы',
    );
    await expect(page.getByLabel('Название задачи', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    const actions = page
      .getByRole('region', { name: 'Действия с задачей', exact: true })
      .getByRole('button');
    await expect(actions).not.toHaveCount(0);
    for (const button of await actions.all()) await expect(button).toBeDisabled();
    await checkLayouts(page);
    expect(await server.snapshot()).toEqual(before);
  } finally {
    await context.setOffline(false);
    await page.context().close();
    await server.close();
  }
});

test('collapsed review filters and snapshot details retain real scoped reads and refresh metadata', async ({
  page,
}) => {
  const server = await mobileUxServer();
  try {
    const before = await server.snapshot();
    for (const view of [
      { path: 'priorities', title: 'Приоритеты', schema: prioritiesPageEnvelopeSchema },
      { path: 'agenda', title: 'План', schema: agendaPageEnvelopeSchema },
    ]) {
      const nextRead = () =>
        page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            new URL(response.url()).pathname === `/api/v1/${view.path}`,
        );
      const initialRead = nextRead();
      await page.goto(`${server.origin}/${view.path}?all_projects=true`);
      const initial = view.schema.parse(await (await initialRead).json());
      await expect(page).toHaveTitle(`${view.title} · Мои задачи`);
      await expect(page.getByRole('heading', { name: view.title, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(mobileTitle, 'u') })).toBeVisible();
      const filters = page.locator('summary').filter({ hasText: 'Фильтры и поиск' });
      const metadata = page.locator('summary').filter({ hasText: 'Данные и обновление' });
      await expect(page.getByLabel('Поиск', { exact: true })).not.toBeVisible();
      await expect(metadata.locator('..').locator('time').first()).not.toBeVisible();
      await metadata.click();
      await expect(metadata.locator('..').locator('time').first()).toHaveAttribute(
        'datetime',
        initial.meta.as_of,
      );
      await expect(metadata.locator('..')).toContainText(initial.meta.timezone);
      await metadata.click();
      await filters.click();
      await page.getByLabel('Область задач', { exact: true }).selectOption('project');
      await page.getByLabel('Slug проекта', { exact: true }).fill(mobileProject.slug);
      await page.getByLabel('Поиск', { exact: true }).fill(mobileTitle);
      const filteredRead = nextRead();
      await page.getByRole('button', { name: 'Применить фильтры', exact: true }).click();
      const filteredResponse = await filteredRead;
      const requestQuery = new URL(filteredResponse.url()).searchParams;
      expect(requestQuery.get('project_slug')).toBe(mobileProject.slug);
      expect(requestQuery.get('q')).toBe(mobileTitle);
      const filtered = view.schema.parse(await filteredResponse.json());
      expect(filtered.data.groups.map((group) => group.project.slug)).toEqual([mobileProject.slug]);
      expect(
        filtered.data.groups.flatMap((group) => group.items.map((task) => task.title)),
      ).toEqual([mobileTitle]);
      await expect(page.getByRole('link', { name: new RegExp(mobileTitle, 'u') })).toBeVisible();
      await expect(page.locator('[aria-label="Применённые фильтры"]')).toContainText(mobileTitle);
      await metadata.click();
      const details = metadata.locator('..');
      await expect(details.locator('time').first()).toHaveAttribute(
        'datetime',
        filtered.meta.as_of,
      );
      await expect(details.locator('time').last()).toHaveAttribute('datetime', filtered.meta.now);
      const refreshedRead = nextRead();
      await page.getByRole('button', { name: 'Обновить с первой страницы', exact: true }).click();
      const refreshed = view.schema.parse(await (await refreshedRead).json());
      await expect(details.locator('time').first()).toHaveAttribute(
        'datetime',
        refreshed.meta.as_of,
      );
      await expect(details.locator('time').last()).toHaveAttribute('datetime', refreshed.meta.now);
      await expect(page).toHaveTitle(`${view.title} · Мои задачи`);
      await filters.click();
      await expect(page.getByLabel('Поиск', { exact: true })).toHaveValue(mobileTitle);
      await expect(page.getByLabel('Slug проекта', { exact: true })).toHaveValue(
        mobileProject.slug,
      );
    }
    expect(await server.snapshot()).toEqual(before);
  } finally {
    await page.context().close();
    await server.close();
  }
});
