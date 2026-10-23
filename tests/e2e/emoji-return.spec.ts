import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { z } from 'zod/mini';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { openTaskActions } from '../fixtures/task-ui.js';
const storedTaskSchema = z.object({
  id: z.uuid(),
  revision: z.number(),
  emoji: z.string(),
  description: z.string(),
  status_id: z.string(),
});
type Scope = {
  slug: string;
  epoch: string;
  origin: string;
};
async function mutate(
  request: APIRequestContext,
  scope: Scope,
  suffix: string,
  input: {
    payload: unknown;
    revision?: number;
  },
) {
  const response = await request.post(`/api/v1/projects/${scope.slug}${suffix}`, {
    headers: {
      Origin: scope.origin,
      'Content-Type': 'application/json',
      'X-AI-Tasks-Mutation': '1',
    },
    data: {
      operation_id: randomUUID(),
      database_epoch: scope.epoch,
      expected_config_revision: 1,
      ...(input.revision === undefined ? {} : { expected_revision: input.revision }),
      payload: input.payload,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return successEnvelopeSchema.parse(await response.json()).data;
}
test('explicit return with ⚪ keeps that choice when the original marker becomes free', async ({
  page,
  request,
}, info) => {
  await page.goto('/projects');
  const origin = new URL(page.url()).origin;
  const metadata = metaEnvelopeSchema.parse(
    await (await request.get('/api/v1/meta?all_projects=true')).json(),
  );
  const slug = `emoji-return-${randomUUID().slice(0, 8)}`;
  const scope = { slug, origin, epoch: metadata.data.database_epoch };
  const created = await request.post(`/api/v1/projects/${slug}`, {
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-AI-Tasks-Mutation': '1' },
    data: {
      operation_id: randomUUID(),
      database_epoch: scope.epoch,
      payload: {
        slug,
        name: 'Явный выбор эмодзи при возврате',
        emoji: info.project.name === 'webkit' ? '🏔️' : '🌋',
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const original = storedTaskSchema.parse(
    await mutate(request, scope, '/tasks', {
      payload: {
        kind: 'ordinary',
        title: 'Вернуть с выбранным маркером',
        emoji: '🧪',
        description: 'Точный **исходник** 👩🏽‍💻\n\nБез изменений.',
      },
    }),
  );
  await mutate(request, scope, `/tasks/${original.id}/archive`, {
    payload: {},
    revision: original.revision,
  });
  const occupant = storedTaskSchema.parse(
    await mutate(request, scope, '/tasks', {
      payload: {
        kind: 'ordinary',
        title: 'Временно занимает маркер',
        emoji: '🧪',
      },
    }),
  );
  await page.goto(`/projects/${slug}/tasks/${original.id}`);
  const restorePath = `/api/v1/projects/${slug}/tasks/${original.id}/restore`;
  const rejected = page.waitForResponse(
    (response) => response.url().endsWith(restorePath) && response.request().method() === 'POST',
  );
  await openTaskActions(page);
  await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
  expect((await rejected).status()).toBe(409);
  const defaultChoice = page.getByRole('button', { name: 'Восстановить с ⚪', exact: true });
  await expect(defaultChoice).toBeVisible();
  // Real server state changes after the explicit choices appeared; the chosen marker is binding.
  await mutate(request, scope, `/tasks/${occupant.id}/archive`, {
    payload: {},
    revision: occupant.revision,
  });
  const restored = page.waitForResponse(
    (response) => response.url().endsWith(restorePath) && response.request().method() === 'POST',
  );
  await defaultChoice.click();
  const response = await restored;
  expect(response.status()).toBe(200);
  const body = z
    .object({ payload: z.record(z.string(), z.unknown()) })
    .parse(response.request().postDataJSON());
  expect
    .soft(body.payload)
    .toMatchObject({ replacement_emoji: '⚪', emoji_collision: 'use_default' });
  const saved = storedTaskSchema.parse(
    successEnvelopeSchema.parse(
      await (await request.get(`/api/v1/projects/${slug}/tasks/${original.id}`)).json(),
    ).data,
  );
  expect(saved).toMatchObject({
    emoji: '⚪',
    description: original.description,
    status_id: original.status_id,
  });
});
