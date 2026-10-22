import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { z } from 'zod/mini';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { ordinaryWorkflowSchema, recurringWorkflowSchema } from '../../src/schema/configuration.js';
export const browserTask = z.object({
  id: z.uuid(),
  revision: z.number(),
  status_id: z.string(),
  description: z.string(),
  emoji: z.string(),
});
export async function browserMutation(
  page: Page,
  path: string,
  input: {
    payload: unknown;
    revision?: number;
    configRevision?: number;
    method?: 'POST' | 'PATCH';
  },
) {
  const origin = new URL(page.url()).origin;
  const meta = metaEnvelopeSchema.parse(
    await (await page.request.get('/api/v1/meta?all_projects=true')).json(),
  );
  const response = await page.request.fetch(`/api/v1${path}`, {
    method: input.method ?? 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-AI-Tasks-Mutation': '1' },
    data: {
      operation_id: randomUUID(),
      database_epoch: meta.data.database_epoch,
      ...(input.revision === undefined ? {} : { expected_revision: input.revision }),
      ...(input.configRevision === undefined
        ? {}
        : { expected_config_revision: input.configRevision }),
      payload: input.payload,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return successEnvelopeSchema.parse(await response.json());
}
export async function browserConfig(page: Page) {
  const response = await page.request.get('/api/v1/config/presets?all_projects=true');
  expect(response.status()).toBe(200);
  const presets = z
    .object({
      data: z.object({
        ordinary_workflow: ordinaryWorkflowSchema,
        recurring_workflow: recurringWorkflowSchema,
      }),
    })
    .parse(await response.json()).data;
  return {
    priority_model: { type: 'classic' as const },
    ordinary_workflow: presets.ordinary_workflow,
    recurring_workflow: presets.recurring_workflow,
  };
}
export async function browserProject(page: Page, emoji: string, config?: unknown) {
  const slug = `us2-${randomUUID().slice(0, 8)}`;
  await browserMutation(page, `/projects/${slug}`, {
    payload: { slug, name: `Проект ${slug}`, emoji, ...(config ? { config } : {}) },
  });
  return slug;
}
export async function browserSeedTask(
  page: Page,
  slug: string,
  extra: Record<string, unknown> = {},
) {
  return browserTask.parse(
    (
      await browserMutation(page, `/projects/${slug}/tasks`, {
        configRevision: 1,
        payload: {
          kind: 'ordinary',
          title: 'Согласовать договор',
          description: 'Точный **исходник**\n',
          ...extra,
        },
      })
    ).data,
  );
}
export async function expectMobileForm(page: Page) {
  await page.setViewportSize({ width: 360, height: 900 });
  const root = await page.locator('#root').boundingBox();
  if (!root) throw new Error('Application root must be visible');
  expect(root.width).toBeLessThanOrEqual(430);
  for (const form of await page.getByRole('form').all()) {
    const box = await form.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
    }
  }
  const scrollWidth = await page.locator('html').evaluate((element) => element.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);
}
