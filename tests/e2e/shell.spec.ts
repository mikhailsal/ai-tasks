import { expect, test } from '@playwright/test';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';

const metadataPath = '/api/v1/meta?all_projects=true';

test('opens the Russian production shell and real metadata without authentication', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const metadataResponse = page.waitForResponse((response) =>
    response.url().endsWith(metadataPath),
  );
  const document = await page.goto('/');
  expect(document?.status()).toBe(200);
  expect(document?.headers()['x-content-type-options']).toBe('nosniff');
  expect(document?.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(document?.headers()['cache-control']).toBe('no-store');
  const metadata = await metadataResponse;
  expect(metadata.status()).toBe(200);
  expect(metadata.headers()['www-authenticate']).toBeUndefined();
  const body: unknown = await metadata.json();
  expect(metaEnvelopeSchema.parse(body).data).toMatchObject({
    maintenance: false,
    contract_version: 1,
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { name: 'Задачи', exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(navigation.getByRole('link', { name: 'Задачи', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(navigation.getByRole('link', { name: 'Проекты', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /войти|зарегистрироваться/i })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('serves direct project links as the app while unknown API paths remain JSON 404s', async ({
  page,
  request,
}) => {
  const document = await page.goto('/projects');
  expect(document?.status()).toBe(200);
  expect(document?.headers()['content-type']).toContain('text/html');
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Проекты · Мои задачи');
  const missing = await request.get('/api/v1/unknown-shell-test');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('application/json');
  const body: unknown = await missing.json();
  expect(errorEnvelopeSchema.parse(body)).toMatchObject({
    ok: false,
    error: { code: 'ROUTE_NOT_FOUND' },
  });
});

test('keeps a centered single content column on mobile and wide screens', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Задачи', exact: true })).toBeVisible();
  const mobile = page.viewportSize();
  if (!mobile) throw new Error('The browser project must provide a mobile viewport');
  for (const viewport of [mobile, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    const root = await page.locator('#root').boundingBox();
    const main = await page.getByRole('main').boundingBox();
    if (!root || !main) throw new Error('Expected visible application layout');
    expect(root.width).toBeLessThanOrEqual(430);
    expect(root.width).toBeCloseTo(Math.min(viewport.width, 430), 0);
    expect(root.x).toBeCloseTo((viewport.width - root.width) / 2, 0);
    expect(main.x).toBeGreaterThanOrEqual(root.x);
    expect(main.x + main.width).toBeLessThanOrEqual(root.x + root.width);
    const contentWidth = await page.locator('html').evaluate((element) => element.scrollWidth);
    expect(contentWidth).toBeLessThanOrEqual(viewport.width);
  }
});

test('provides 44px navigation targets, keyboard focus and history navigation', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Задачи', exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  const tasks = navigation.getByRole('link', { name: 'Задачи', exact: true });
  const projects = navigation.getByRole('link', { name: 'Проекты', exact: true });
  for (const link of [tasks, projects]) {
    const target = await link.boundingBox();
    if (!target) throw new Error('Expected visible navigation target');
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Перейти к содержимому' });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveCSS('outline-width', '3px');
  await page.keyboard.press('Tab');
  await expect(tasks).toBeFocused();
  await expect(tasks).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  await expect(projects).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/projects');
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Задачи', exact: true })).toBeVisible();
});

test('shows a clear connection failure and recovers through the real metadata endpoint', async ({
  page,
}) => {
  // Fail only the network request; HTML, JavaScript and all successful API responses
  // come from the production service and its disposable migrated database.
  await page.route(`**${metadataPath}`, (route) => route.abort('internetdisconnected'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Нет соединения' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Проверьте подключение' })).toBeVisible();
  const retry = page.getByRole('button', { name: 'Попробовать снова' });
  const target = await retry.boundingBox();
  if (!target) throw new Error('Expected visible retry target');
  expect(target.height).toBeGreaterThanOrEqual(44);
  expect(target.width).toBeGreaterThanOrEqual(44);
  await page.unroute(`**${metadataPath}`);
  const metadataResponse = page.waitForResponse((response) =>
    response.url().endsWith(metadataPath),
  );
  await retry.click();
  expect((await metadataResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Задачи', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
