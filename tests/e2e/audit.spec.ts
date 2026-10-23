import { expect, test, type Page } from '@playwright/test';
import { createProject, updateProject } from '../../src/core/projects/commands.js';
import { updateTask } from '../../src/core/tasks/commands.js';
import { auditPageEnvelopeSchema } from '../../src/schema/audit.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import { auditBrowserServer } from '../fixtures/audit-browser.js';
import { historicalConsent, seedHistoryPages } from '../fixtures/history.js';
import { ordinaryInput } from '../fixtures/ordinary-work.js';

function nextAudit(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/v1/audit',
  );
}

test('historical audit shows original removed status/category, exact consent and wrapped source using the chosen operation', async ({
  page,
}) => {
  const server = await auditBrowserServer();
  try {
    const fixture = server.fixture;
    createProject(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { slug: 'alpha', name: 'Смысл истории', emoji: '📜' }),
    );
    const historical = historicalConsent(fixture);
    const snapshot = server.fixture.connection.sqlite
      .prepare('SELECT * FROM audit_records ORDER BY rowid')
      .all();
    await page.goto(
      `${server.origin}/audit?project_slug=alpha&entity_id=${historical.task.id}&operation_id=${historical.completed.meta.operation_id}`,
    );
    const event = page.getByRole('article', {
      name: `Событие ${historical.completed.meta.audit_ids[0]}`,
      exact: true,
    });
    await expect(event).toBeVisible();
    const status = event.getByRole('region', { name: 'Изменение: Статус', exact: true });
    await expect(status).toContainText('Проверка (sanity_check)');
    await expect(status).toContainText('Готово (done)');
    await expect(status).toContainText('Завершено');
    await expect(status).not.toContainText('Другое сегодняшнее название');
    const consent = event.getByRole('region', { name: 'Подтверждение пользователя', exact: true });
    expect(await consent.locator('pre').textContent()).toBe(historical.confirmation.user_text);
    await expect(event).toContainText('human-web');
    await expect(event).toContainText('Веб-интерфейс');
    await event.getByText('Сохранённый смысл статусов и приоритетов', { exact: true }).click();
    await expect(
      event.getByRole('region', { name: 'Сохранённые значения и правила', exact: true }),
    ).toContainText('Готово (done)');
    expect(
      server.fixture.connection.sqlite.prepare('SELECT * FROM audit_records ORDER BY rowid').all(),
    ).toEqual(snapshot);
    const source = `  **Исходник** 👩🏽‍💻\n${'ДлинноеСлово'.repeat(200)}\n`;
    const current = taskDetailSchema.parse(historical.completed.data);
    const changed = updateTask(
      fixture.agent('alpha'),
      'alpha',
      current.id,
      ordinaryInput(fixture, { description: source }, { revision: current.revision + 1 }),
    );
    await page.getByLabel('UUID операции', { exact: true }).fill(changed.meta.operation_id);
    const loaded = nextAudit(page);
    await page.getByRole('button', { name: 'Показать историю', exact: true }).click();
    expect((await loaded).status()).toBe(200);
    const description = page.getByRole('region', { name: 'Изменение: Описание', exact: true });
    expect(await description.locator('pre').last().textContent()).toBe(source);
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const root = await page.locator('#root').boundingBox();
      if (!root) throw new Error('Expected centered audit root');
      expect(root.width).toBeLessThanOrEqual(430);
      expect(root.x).toBeCloseTo((width - root.width) / 2, 0);
      expect(await page.evaluate('document.documentElement.scrollWidth')).toBeLessThanOrEqual(
        width,
      );
    }
    await page.reload();
    await expect(page.getByLabel('UUID операции', { exact: true })).toHaveValue(
      changed.meta.operation_id,
    );
    expect(await description.locator('pre').last().textContent()).toBe(source);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('audit filters and paging preserve scope and expose stale cursors as a first-page refresh rather than an empty result', async ({
  page,
}) => {
  const server = await auditBrowserServer();
  try {
    const fixture = server.fixture;
    createProject(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { slug: 'alpha', name: 'Альфа', emoji: '📜' }),
    );
    createProject(
      fixture.human,
      'beta',
      ordinaryInput(fixture, { slug: 'beta', name: 'Бета', emoji: '🌲' }, { projectSlug: 'beta' }),
    );
    const task = seedHistoryPages(fixture, 4);
    const loaded = nextAudit(page);
    await page.goto(`${server.origin}/audit?all_projects=true&limit=2`);
    const initial = await loaded;
    expect(initial.status()).toBe(200);
    const first = auditPageEnvelopeSchema.parse(await initial.json());
    await expect(page.getByRole('article')).toHaveCount(2);
    const next = nextAudit(page);
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    const nextResponse = await next;
    expect(nextResponse.status()).toBe(200);
    const second = auditPageEnvelopeSchema.parse(await nextResponse.json());
    expect(second.meta.as_of).toBe(first.meta.as_of);
    expect(new Set([...first.data.items, ...second.data.items].map((row) => row.id)).size).toBe(
      first.data.items.length + second.data.items.length,
    );
    await expect(page.getByRole('article')).toHaveCount(2);
    const returned = nextAudit(page);
    await page.getByRole('button', { name: 'С первой страницы', exact: true }).click();
    expect((await returned).status()).toBe(200);
    await expect(page.getByRole('article')).toHaveCount(2);
    const changed = updateProject(
      fixture.agent('alpha'),
      'alpha',
      ordinaryInput(fixture, { name: 'Изменение во время чтения' }, { revision: 1 }),
    );
    const stale = nextAudit(page);
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    expect((await stale).status()).toBe(409);
    await expect(page.getByRole('alert')).toContainText(/история изменилась/iu);
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByText('По выбранным фильтрам записей нет.', { exact: true })).toHaveCount(
      0,
    );
    const fresh = nextAudit(page);
    await page.getByRole('button', { name: 'Обновить с первой страницы', exact: true }).click();
    expect((await fresh).status()).toBe(200);
    await expect(page.getByRole('article')).toHaveCount(2);
    expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
    expect(first.data.next_cursor).not.toBeNull();
    await page.locator('summary').filter({ hasText: 'Фильтры истории' }).click();
    await page.getByLabel('Область истории', { exact: true }).selectOption('project');
    await page.getByLabel('Slug проекта', { exact: true }).fill('alpha');
    await page.getByLabel('UUID сущности', { exact: true }).fill(task.id);
    const filtered = nextAudit(page);
    await page.getByRole('button', { name: 'Показать историю', exact: true }).click();
    const items = auditPageEnvelopeSchema.parse(await (await filtered).json()).data.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((row) => row.project_slug === 'alpha' && row.entity_id === task.id)).toBe(
      true,
    );
    await page.getByLabel('Область истории', { exact: true }).selectOption('all');
    await page.getByLabel('UUID сущности', { exact: true }).fill('');
    await page.getByLabel('UUID операции', { exact: true }).fill(changed.meta.operation_id);
    const operation = nextAudit(page);
    await page.getByRole('button', { name: 'Показать историю', exact: true }).click();
    expect(
      auditPageEnvelopeSchema.parse(await (await operation).json()).data.items.map((row) => row.id),
    ).toEqual(changed.meta.audit_ids);
    await expect(page.getByRole('article')).toHaveCount(1);
  } finally {
    await page.context().close();
    await server.close();
  }
});
