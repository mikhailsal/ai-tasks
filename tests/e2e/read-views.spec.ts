import { expect, test, type Page, type Locator } from '@playwright/test';
import { updateTask } from '../../src/core/tasks/commands.js';
import { deadlineDraft } from '../../web/src/data/local-time.js';
import { ordinaryInput } from '../fixtures/ordinary-work.js';
import { createReadViewsHarness } from '../fixtures/read-views-contract.js';
import { agendaPageSchema, statisticsSchema } from '../fixtures/read-views-responses.js';

function project(page: Page, slug: string) {
  return page.getByRole('region', { name: `Проект ${slug}`, exact: true });
}
async function mobile(page: Page, control: Locator) {
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const root = await page.locator('#root').boundingBox();
    if (!root) throw new Error('Missing centered application root');
    expect(root.width).toBeLessThanOrEqual(430);
    expect(root.x).toBeCloseTo((width - root.width) / 2, 0);
    expect(await page.evaluate('document.documentElement.scrollWidth')).toBeLessThanOrEqual(width);
  }
  const bounds = await control.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
}
function nextView(page: Page, view: string) {
  return page.waitForResponse(
    (reply) =>
      reply.request().method() === 'GET' && new URL(reply.url()).pathname === `/api/v1/${view}`,
  );
}

test('priorities keep projects and all four models distinct with configured labels, flags, numeric direction and unset last', async ({
  page,
}) => {
  const server = await createReadViewsHarness();
  try {
    const seed = server.seed({ asOf: Date.now() });
    const before = server.snapshot();
    await page.goto(`${server.origin}/priorities?all_projects=true&q=rank%3A`);
    await expect(page.getByRole('heading', { name: 'Приоритеты', exact: true })).toBeVisible();
    const groups = page.getByRole('region', { name: /^Проект /u });
    await expect(groups).toHaveCount(5);
    expect(
      await groups.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))),
    ).toEqual(seed.projectOrder.map((slug) => `Проект ${slug}`));
    await expect(project(page, 'classic')).toContainText('Классический');
    await expect(project(page, 'classic')).toContainText('Критический');
    await expect(project(page, 'beta-named')).toContainText('Первый');
    await expect(project(page, 'beta-named')).toContainText('Второй');
    await expect(project(page, 'max-numeric')).toContainText('больше — важнее');
    await expect(project(page, 'min-numeric')).toContainText('меньше — важнее');
    for (const text of [
      'Важно и срочно',
      'Важно, не срочно',
      'Не важно, срочно',
      'Не важно и не срочно',
      'Без приоритета',
    ])
      await expect(project(page, 'alpha-eisen')).toContainText(text);
    const namedLinks = project(page, 'beta-named').getByRole('link', { name: /rank:/u });
    expect(
      await namedLinks.evaluateAll((items) => items.map((item) => item.getAttribute('href'))),
    ).toEqual(
      ['rank_named_first', 'rank_named_second', 'rank_named_unset'].map(
        (key) => `/projects/beta-named/tasks/${seed.idsByMeaning[key]}`,
      ),
    );
    await mobile(page, page.getByRole('button', { name: 'Применить фильтры', exact: true }));
    expect(server.snapshot()).toEqual(before);
  } finally {
    await page.close();
    await server.close();
  }
});

test('agenda is project-first with five disjoint sections and one recurring parent at its earliest open deadline', async ({
  page,
}) => {
  const server = await createReadViewsHarness();
  try {
    const seed = server.seed({ asOf: Date.now() });
    const before = server.snapshot();
    await page.goto(`${server.origin}/agenda?all_projects=true&q=agenda%3A`);
    await expect(page.getByRole('heading', { name: 'План', exact: true })).toBeVisible();
    const classic = project(page, 'classic');
    for (const name of ['Просрочено', 'Сегодня', 'Следующие 7 дней', 'Позже', 'Без срока'])
      await expect(classic.getByRole('region', { name, exact: true })).toBeVisible();
    await expect(classic.getByRole('region', { name: 'Просрочено', exact: true })).toContainText(
      'agenda: overdue',
    );
    await expect(classic.getByRole('region', { name: 'Сегодня', exact: true })).toContainText(
      'agenda: today_last',
    );
    await expect(
      classic.getByRole('region', { name: 'Следующие 7 дней', exact: true }),
    ).toContainText('agenda: next_start');
    await expect(classic.getByRole('region', { name: 'Позже', exact: true })).toContainText(
      'agenda: later',
    );
    await expect(classic.getByRole('region', { name: 'Без срока', exact: true })).toContainText(
      'agenda: recurring empty',
    );
    const parent = classic.locator(
      `a[href="/projects/classic/tasks/${seed.idsByMeaning.recurring_open}"]`,
    );
    await expect(parent).toHaveCount(1);
    await expect(parent).toBeVisible();
    await expect(classic).toContainText('По открытому повторению');
    await expect(page.getByRole('region', { name: /^Проект /u }).first()).toHaveAttribute(
      'aria-label',
      'Проект max-numeric',
    );
    await expect(
      classic.getByRole('button', { name: 'Скопировать эмодзи проекта', exact: true }),
    ).toBeVisible();
    await mobile(page, page.getByRole('button', { name: 'Применить фильтры', exact: true }));
    await page.reload();
    await expect(page.getByLabel('Поиск', { exact: true })).toHaveValue('agenda:');
    expect(server.snapshot()).toEqual(before);
  } finally {
    await page.close();
    await server.close();
  }
});

test('agenda paging retains server as_of despite browser time changes and exposes stale cursors with explicit first-page refresh', async ({
  page,
}) => {
  const server = await createReadViewsHarness();
  try {
    const seed = server.seed({ asOf: Date.now() });
    const loaded = nextView(page, 'agenda');
    await page.goto(`${server.origin}/agenda?project_slug=classic&q=agenda%3A&limit=2`);
    const first = agendaPageSchema.parse(await (await loaded).json());
    const initial = first.data.groups.flatMap((group) => group.items);
    expect(initial).toHaveLength(2);
    await page.clock.setFixedTime(new Date(Date.parse(first.meta.as_of ?? '') + 2 * 86_400_000));
    const more = nextView(page, 'agenda');
    await page.getByRole('button', { name: 'Загрузить ещё задачи', exact: true }).click();
    const second = agendaPageSchema.parse(await (await more).json());
    expect(second.meta.as_of).toBe(first.meta.as_of);
    const ids = [...initial, ...second.data.groups.flatMap((group) => group.items)].map(
      (item) => item.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    await expect(project(page, 'classic')).toHaveCount(1);
    for (const item of initial)
      await expect(page.locator(`a[href="/projects/classic/tasks/${item.id}"]`)).toHaveCount(1);
    const id = seed.idsByMeaning.overdue;
    if (!id) throw new Error('Missing seeded overdue task');
    updateTask(
      server.fixture.human,
      'classic',
      id,
      ordinaryInput(
        server.fixture,
        { title: 'agenda: updated' },
        { projectSlug: 'classic', revision: 1 },
      ),
    );
    const stale = nextView(page, 'agenda');
    await page.getByRole('button', { name: 'Загрузить ещё задачи', exact: true }).click();
    expect((await stale).status()).toBe(409);
    await expect(page.getByRole('alert')).toContainText('Список изменился');
    await expect(page.getByText('Задач пока нет.', { exact: true })).toHaveCount(0);
    const refreshed = nextView(page, 'agenda');
    await page.getByRole('button', { name: 'Обновить с первой страницы', exact: true }).click();
    const current = agendaPageSchema.parse(await (await refreshed).json());
    expect(current.meta.as_of).not.toBe(first.meta.as_of);
    expect(current.meta.read_revision).not.toBe(first.meta.read_revision);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await page.close();
    await server.close();
  }
});

test('workload distinguishes parent inventory and occurrence outcomes and explains half-open equal and reversed ranges', async ({
  page,
}) => {
  const server = await createReadViewsHarness();
  try {
    const seed = server.seed({ asOf: Date.now() });
    const before = server.snapshot();
    await page.goto(
      `${server.origin}/workload?project_slug=classic&q=stats%3A&include_terminal=true`,
    );
    await expect(page.getByRole('heading', { name: 'Нагрузка', exact: true })).toBeVisible();
    const tasks = page.getByRole('region', { name: 'Задачи', exact: true });
    const occurrences = page.getByRole('region', { name: 'Повторения', exact: true });
    await expect(tasks).toContainText('Всего: 4');
    await expect(tasks).toContainText('Обычные: 3');
    await expect(tasks).toContainText('Повторяемые: 1');
    await expect(occurrences).toContainText('Всего: 6');
    await expect(occurrences).toContainText('Выполнено поздно: 1');
    const local = deadlineDraft(new Date(seed.completedAt).toISOString(), 'Europe/Berlin');
    await page.getByLabel('Дата от (включительно)', { exact: true }).fill(local.date);
    await page.getByLabel('Время от (включительно)', { exact: true }).fill(local.time);
    await page.getByLabel('Дата до (не включительно)', { exact: true }).fill(local.date);
    await page.getByLabel('Время до (не включительно)', { exact: true }).fill(local.time);
    const empty = nextView(page, 'stats');
    await page.getByRole('button', { name: 'Применить период', exact: true }).click();
    const result = statisticsSchema.parse(await (await empty).json());
    expect(result.data.tasks.total).toBe(0);
    expect(result.data.occurrences.total).toBe(0);
    await expect(page.getByRole('status')).toContainText('Границы совпадают');
    await page.getByLabel('Дата до (не включительно)', { exact: true }).fill('2000-01-01');
    let requests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/v1/stats') requests += 1;
    });
    await page.getByRole('button', { name: 'Применить период', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Начало периода позже конца');
    expect(requests).toBe(0);
    await mobile(page, page.getByRole('button', { name: 'Применить период', exact: true }));
    expect(server.snapshot()).toEqual(before);
  } finally {
    await page.close();
    await server.close();
  }
});
