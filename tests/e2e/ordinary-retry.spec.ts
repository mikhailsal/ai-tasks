import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { z } from 'zod/mini';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { mutationSuccessEnvelopeSchema } from '../../src/schema/envelopes.js';
import {
  installBrowserResponseLoss,
  waitForBrowserResponseLoss,
} from '../fixtures/browser-response-loss.js';
test('recovers a committed create after response loss and reload by explicitly retrying the same operation', async ({
  page,
}, info) => {
  await page.goto('/');
  const metadata = metaEnvelopeSchema.parse(
    await (await page.request.get('/api/v1/meta?all_projects=true')).json(),
  );
  const slug = `retry-${randomUUID().slice(0, 8)}`;
  const project = await page.request.post(`/api/v1/projects/${slug}`, {
    headers: {
      Origin: new URL(page.url()).origin,
      'Content-Type': 'application/json',
      'X-AI-Tasks-Mutation': '1',
    },
    data: {
      operation_id: randomUUID(),
      database_epoch: metadata.data.database_epoch,
      payload: {
        slug,
        name: 'Проверка повторной доставки',
        emoji: info.project.name === 'webkit' ? '🏓' : '🪁',
      },
    },
  });
  expect(project.status()).toBe(201);
  const endpoint = `/api/v1/projects/${slug}/tasks`;
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === endpoint)
      sent.push(request.postData() ?? '');
  });
  await page.goto(`/projects/${slug}/tasks/new`);
  await page.getByLabel('Название задачи', { exact: true }).fill('Одна сохранённая задача');
  await page.getByLabel('Описание', { exact: true }).fill('Исходник после потери ответа 👩🏽‍💻');
  await installBrowserResponseLoss(page, { method: 'POST', path: endpoint });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const lost = await waitForBrowserResponseLoss(page);
  expect(lost.status).toBe(201);
  const committed = mutationSuccessEnvelopeSchema.parse(JSON.parse(lost.body));
  const retry = page.getByRole('button', { name: 'Повторить ту же операцию', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByLabel('Название задачи', { exact: true })).toBeDisabled();
  expect(sent).toHaveLength(1);
  await page.reload();
  await expect(retry).toBeVisible();
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
    'Исходник после потери ответа 👩🏽‍💻',
  );
  expect(sent).toHaveLength(1);
  const replayed = page.waitForResponse(
    (response) => response.url().endsWith(endpoint) && response.request().method() === 'POST',
  );
  await retry.click();
  const response = await replayed;
  expect(response.status()).toBe(201);
  expect(mutationSuccessEnvelopeSchema.parse(await response.json())).toEqual(committed);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toBe(sent[0]);
  const collection = await page.request.get(
    `/api/v1/tasks?project_slug=${slug}&archive=include&include_terminal=true`,
  );
  expect(collection.status()).toBe(200);
  expect(
    z.object({ data: z.object({ items: z.array(z.unknown()) }) }).parse(await collection.json())
      .data.items,
  ).toHaveLength(1);
});
