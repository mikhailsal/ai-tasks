import { leaveWithDraft, openTaskActions } from '../fixtures/task-ui.js';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { z } from 'zod/mini';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
let slug: string;
let epoch: string;
let origin: string;
const taskIdentity = z.object({ id: z.uuid(), revision: z.number() });
async function mutate(
  request: APIRequestContext,
  path: string,
  payload: unknown,
  revision?: number,
) {
  const response = await request.post(`/api/v1/projects/${slug}${path}`, {
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-AI-Tasks-Mutation': '1' },
    data: {
      operation_id: randomUUID(),
      database_epoch: epoch,
      expected_config_revision: 1,
      ...(revision === undefined ? {} : { expected_revision: revision }),
      payload,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return successEnvelopeSchema.parse(await response.json());
}
// Each case has a distinct permanent marker, including after worker restarts.
test.beforeEach(async ({ request }, info) => {
  origin = new URL((await request.get('/')).url()).origin;
  epoch = metaEnvelopeSchema.parse(
    await (await request.get('/api/v1/meta?all_projects=true')).json(),
  ).data.database_epoch;
  slug = `safety-${randomUUID().slice(0, 8)}`;
  const presetResponse = await request.get('/api/v1/config/presets?all_projects=true');
  expect(presetResponse.status()).toBe(200);
  const presets = z
    .object({ data: z.object({ recurring_workflow: z.unknown() }) })
    .parse(await presetResponse.json());
  const response = await request.post(`/api/v1/projects/${slug}`, {
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-AI-Tasks-Mutation': '1' },
    data: {
      operation_id: randomUUID(),
      database_epoch: epoch,
      payload: {
        slug,
        name: 'Безопасность действий',
        emoji: (info.project.name === 'webkit' ? ['🛟', '🪕', '🧶'] : ['🧭', '🥁', '🧵'])[
          info.title.startsWith('two synchronous')
            ? 1
            : info.title.startsWith('stale completion')
              ? 2
              : 0
        ],
        config: {
          priority_model: { type: 'classic' },
          recurring_workflow: presets.data.recurring_workflow,
          ordinary_workflow: {
            initial_status_id: 'idea',
            statuses: [
              { id: 'idea', label: 'Идея', color: 'slate', category: 'not_started' },
              { id: 'done', label: 'Готово', color: 'green', category: 'completed' },
            ],
            transitions: [{ from: 'idea', to: 'done', requires_confirmation: true }],
          },
        },
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
});
test('a restored dirty draft keeps its source and exposes Restore after an external archive', async ({
  page,
  request,
}) => {
  const task = taskIdentity.parse(
    (await mutate(request, '/tasks', { kind: 'ordinary', title: 'Архив и черновик' })).data,
  );
  await page.goto(`/projects/${slug}/tasks/${task.id}`);
  await expect(page.getByLabel('Название задачи', { exact: true })).toBeVisible();
  await page.getByLabel('Описание', { exact: true }).fill('Мой несохранённый исходник **целиком**');
  await leaveWithDraft(page, () => page.reload());
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
    'Мой несохранённый исходник **целиком**',
  );
  await mutate(request, `/tasks/${task.id}/archive`, {}, task.revision);
  await leaveWithDraft(page, () => page.reload());
  await openTaskActions(page);
  await expect(page.getByRole('button', { name: 'Восстановить', exact: true })).toBeVisible();
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
    'Мой несохранённый исходник **целиком**',
  );
  await expect(page.getByLabel('Описание', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
  await expect(page.getByLabel('Описание', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
    'Мой несохранённый исходник **целиком**',
  );
});
test('two synchronous form submissions create exactly one task and one request', async ({
  page,
  request,
}) => {
  const title = `Одна задача ${randomUUID()}`;
  let posts = 0;
  page.on('request', (entry) => {
    if (
      entry.method() === 'POST' &&
      new URL(entry.url()).pathname === `/api/v1/projects/${slug}/tasks`
    )
      posts++;
  });
  await page.goto(`/projects/${slug}/tasks/new`);
  await page.getByLabel('Название задачи', { exact: true }).fill(title);
  await page.getByRole('form', { name: 'Редактор задачи' }).evaluate((form) => {
    function supportsSubmit(value: unknown): value is {
      requestSubmit(): void;
    } {
      return (
        typeof value === 'object' &&
        value !== null &&
        'requestSubmit' in value &&
        typeof value.requestSubmit === 'function'
      );
    }
    if (!supportsSubmit(form)) throw new Error('Expected native form');
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page).toHaveURL(new RegExp(`/projects/${slug}/tasks/[0-9a-f-]{36}$`, 'u'));
  const collection = z
    .object({ data: z.object({ items: z.array(z.object({ title: z.string() })) }) })
    .parse(
      await (
        await request.get(
          `/api/v1/tasks?project_slug=${slug}&archive=include&include_terminal=true`,
        )
      ).json(),
    );
  expect(collection.data.items.filter((task) => task.title === title)).toHaveLength(1);
  expect(posts).toBe(1);
});
test('stale completion retains the exact consent and target for explicit reconciliation', async ({
  page,
  request,
}) => {
  const task = taskIdentity.parse(
    (await mutate(request, '/tasks', { kind: 'ordinary', title: 'Согласованное завершение' })).data,
  );
  await page.goto(`/projects/${slug}/tasks/${task.id}`);
  await openTaskActions(page);
  await page.getByRole('button', { name: /Завершить/u }).click();
  const dialog = page.getByRole('dialog', { name: 'Подтвердите переход', exact: true });
  await expect(dialog).toContainText('Согласованное завершение');
  await expect(dialog).toContainText('Идея → Готово');
  await dialog.getByLabel('Текст подтверждения').fill('Проверил результат лично');
  // Change the real revision after the dialog captures the intended transition.
  const patched = await request.patch(`/api/v1/projects/${slug}/tasks/${task.id}`, {
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-AI-Tasks-Mutation': '1' },
    data: {
      operation_id: randomUUID(),
      database_epoch: epoch,
      expected_revision: task.revision,
      expected_config_revision: 1,
      payload: { description: 'Новая серверная версия' },
    },
  });
  expect(patched.status()).toBe(200);
  const sent: unknown[] = [];
  page.on('request', (entry) => {
    if (entry.method() === 'POST' && entry.url().endsWith(`/tasks/${task.id}/transitions`))
      sent.push(entry.postDataJSON());
  });
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Текущая версия' })).toBeVisible();
  const proposed = page.getByRole('region', { name: 'Ваш вариант' });
  await expect(proposed).toContainText('Проверил результат лично');
  await expect(proposed).toContainText('done');
  await page.getByRole('button', { name: 'Сохранить мой вариант ещё раз' }).click();
  await openTaskActions(page);
  await expect(page.getByRole('button', { name: 'В архив', exact: true })).toBeEnabled();
  const current = z
    .object({ data: z.object({ status_id: z.string(), description: z.string() }) })
    .parse(await (await request.get(`/api/v1/projects/${slug}/tasks/${task.id}`)).json());
  expect(current.data).toEqual({ status_id: 'done', description: 'Новая серверная версия' });
  const proposals = z
    .array(
      z.object({ operation_id: z.string(), payload: z.unknown(), expected_revision: z.number() }),
    )
    .parse(sent);
  expect(proposals).toHaveLength(2);
  expect(proposals[1]?.payload).toEqual(proposals[0]?.payload);
  expect(proposals[1]?.operation_id).not.toBe(proposals[0]?.operation_id);
  expect(proposals[1]?.expected_revision).toBe(2);
});
