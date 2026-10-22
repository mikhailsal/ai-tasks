import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod/mini';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { errorEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import { deliveryServer, developmentDelivery } from '../fixtures/http-delivery.js';
async function seedDeliveryTask(page: Page, origin: string) {
  const epoch = metaEnvelopeSchema.parse(
    await (await page.request.get(`${origin}/api/v1/meta?all_projects=true`)).json(),
  ).data.database_epoch;
  const slug = `delivery-${randomUUID().slice(0, 8)}`;
  const headers = { Origin: origin, 'X-AI-Tasks-Mutation': '1' };
  const project = await page.request.post(`${origin}/api/v1/projects/${slug}`, {
    headers,
    data: {
      operation_id: randomUUID(),
      database_epoch: epoch,
      payload: { slug, name: 'Доставка и история', emoji: '📜' },
    },
  });
  expect(project.status(), await project.text()).toBe(201);
  const response = await page.request.post(`${origin}/api/v1/projects/${slug}/tasks`, {
    headers,
    data: {
      operation_id: randomUUID(),
      database_epoch: epoch,
      expected_config_revision: 1,
      payload: {
        kind: 'ordinary',
        title: 'Сохранённая история',
        description: '  Исходный **план** 👩🏽‍💻\n',
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return {
    slug,
    epoch,
    task: taskDetailSchema.parse(successEnvelopeSchema.parse(await response.json()).data),
  };
}
test('production deep links and same-origin audit links retain exact project/entity scope without login or telemetry', async ({
  page,
}) => {
  const server = await deliveryServer();
  try {
    const { slug, task } = await seedDeliveryTask(page, server.origin);
    const outbound: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== server.origin)
        outbound.push(request.url());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const document = await page.goto(`${server.origin}/projects/${slug}/tasks/${task.id}`);
    expect(document?.status()).toBe(200);
    expect(document?.headers()['content-type']).toContain('text/html');
    expect(document?.headers()['content-security-policy']).toContain("connect-src 'self'");
    expect(document?.headers()['www-authenticate']).toBeUndefined();
    await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /войти|зарегистрироваться/iu })).toHaveCount(0);
    const link = page.getByRole('link', { name: /история изменений|история задачи/iu });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    if (!href) throw new Error('Expected a navigable task audit link');
    const target = new URL(href, server.origin);
    expect(target.origin).toBe(server.origin);
    expect(target.pathname).toBe('/audit');
    expect(target.searchParams.get('project_slug')).toBe(slug);
    expect(target.searchParams.get('entity_id')).toBe(task.id);
    const loaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        url.pathname === '/api/v1/audit' &&
        url.searchParams.get('project_slug') === slug &&
        url.searchParams.get('entity_id') === task.id
      );
    });
    await link.click();
    const audit = await loaded;
    expect(audit.status()).toBe(200);
    const data = z
      .object({
        data: z.object({
          items: z.array(z.object({ project_slug: z.string(), entity_id: z.string() })),
        }),
      })
      .parse(await audit.json());
    expect(data.data.items.length).toBeGreaterThan(0);
    expect(
      data.data.items.every((event) => event.project_slug === slug && event.entity_id === task.id),
    ).toBe(true);
    await expect(page.getByRole('heading', { name: /истори|аудит/iu })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: /истори|аудит/iu })).toBeVisible();
    expect(outbound).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
    await server.close();
  }
});
test('unknown production API paths and missing assets remain safe JSON404 rather than SPA HTML', async ({
  page,
}) => {
  const server = await deliveryServer();
  try {
    await page.goto(`${server.origin}/projects`);
    for (const path of [
      '/api',
      '/api/v1/unknown-delivery-route',
      '/api/v1/projects/nonexistent/tasks/missing/unknown-delivery',
      '/missing-delivery-asset.js',
    ]) {
      const response = await page.request.get(`${server.origin}${path}`);
      expect(response.status()).toBe(404);
      expect(response.headers()['content-type']).toContain('application/json');
      expect(errorEnvelopeSchema.parse(await response.json()).error.code).toBe('ROUTE_NOT_FOUND');
      expect(await response.text()).not.toContain('<!doctype');
    }
  } finally {
    await page.context().close();
    await server.close();
  }
});
test('the actual Vite development proxy reads and writes the real backend under its permitted browser origin', async ({
  page,
}) => {
  const development = await developmentDelivery();
  try {
    const metadata = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/v1/meta',
    );
    const document = await page.goto(`${development.origin}/projects`);
    expect(document?.status()).toBe(200);
    expect((await metadata).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
    const { slug, epoch } = await seedDeliveryTask(page, development.origin);
    const source = '  Dev proxy сохраняет исходник 👩🏽‍💻\n';
    const result = await page.evaluate(
      async (input) => {
        const response = await fetch(input.path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-AI-Tasks-Mutation': '1' },
          body: JSON.stringify(input.body),
        });
        const value: unknown = await response.json();
        return { status: response.status, value };
      },
      {
        path: `/api/v1/projects/${slug}/tasks`,
        body: {
          operation_id: randomUUID(),
          database_epoch: epoch,
          expected_config_revision: 1,
          payload: { kind: 'ordinary', title: 'Запись через Vite', description: source },
        },
      },
    );
    expect(result.status).toBe(201);
    const task = taskDetailSchema.parse(successEnvelopeSchema.parse(result.value).data);
    expect(task.description).toBe(source);
    const persisted = await page.request.get(
      `${development.backend.origin}/api/v1/projects/${slug}/tasks/${task.id}`,
    );
    expect(persisted.status()).toBe(200);
    expect(
      taskDetailSchema.parse(successEnvelopeSchema.parse(await persisted.json()).data).description,
    ).toBe(source);
  } finally {
    await page.close();
    await development.close();
  }
});
