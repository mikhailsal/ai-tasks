import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod/mini';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { configurationSafetyServer } from '../fixtures/configuration-safety.js';
const failOneConfigurationDraftPut = `
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const record = args[0];
    if (this.transaction.db.name === 'ai-tasks-browser-drafts'
      && record !== null && typeof record === 'object'
      && typeof record.key === 'string' && record.key.startsWith('configuration:')
      && sessionStorage.getItem('configuration-draft-put-armed') === 'yes'
      && sessionStorage.getItem('configuration-draft-put-failed') !== 'yes') {
      sessionStorage.setItem('configuration-draft-put-failed', 'yes');
      throw new DOMException('Injected one-shot configuration draft failure', 'UnknownError');
    }
    return originalPut.apply(this, args);
  };
`;
const readDraftStore = `new Promise((resolve, reject) => {
  const opened = indexedDB.open('ai-tasks-browser-drafts');
  opened.onerror = () => reject(opened.error);
  opened.onsuccess = () => {
    const db = opened.result;
    const transaction = db.transaction('draft-records', 'readonly');
    const request = transaction.objectStore('draft-records').getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  };
})`;
async function seedProject(page: Page, origin: string) {
  const meta = metaEnvelopeSchema.parse(
    await (await page.request.get(`${origin}/api/v1/meta?all_projects=true`)).json(),
  );
  const slug = `draft-storage-${randomUUID().slice(0, 8)}`;
  const response = await page.request.post(`${origin}/api/v1/projects/${slug}`, {
    headers: { Origin: origin, 'X-AI-Tasks-Mutation': '1' },
    data: {
      operation_id: randomUUID(),
      database_epoch: meta.data.database_epoch,
      payload: { slug, name: 'Локальный черновик настроек', emoji: '🪴' },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return { slug, epoch: meta.data.database_epoch };
}
test('a transient configuration draft write failure retains input and recovers explicitly without migration', async ({
  page,
}) => {
  const server = await configurationSafetyServer();
  try {
    const { slug, epoch } = await seedProject(page, server.origin);
    await page.addInitScript({ content: failOneConfigurationDraftPut });
    await page.goto(`${server.origin}/projects/${slug}/configuration`);
    const ordinary = page.getByRole('group', { name: 'Обычный рабочий процесс', exact: true });
    const label = ordinary.getByLabel('Название статуса', { exact: true }).first();
    const originalLabel = await label.inputValue();
    const proposedLabel = 'Сохранённый после сбоя замысел';
    let migrations = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith(`/projects/${slug}/config/migrate`))
        migrations += 1;
    });
    await page.evaluate("sessionStorage.setItem('configuration-draft-put-armed', 'yes')");
    await label.fill(proposedLabel);
    await expect(page.getByRole('alert')).toContainText(/не удалось сохранить черновик/iu);
    await expect(label).toHaveValue(proposedLabel);
    await expect(
      page.getByRole('button', { name: 'Применить изменения', exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate("sessionStorage.getItem('configuration-draft-put-failed')")).toBe(
      'yes',
    );
    await page.getByRole('button', { name: 'Повторить сохранение черновика', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Предпросмотр изменений', exact: true }),
    ).toBeEnabled();
    const stored: unknown = await page.evaluate(readDraftStore);
    const drafts = z
      .array(
        z.object({
          key: z.string(),
          base: z.object({
            database_epoch: z.string(),
            expected_revision: z.number(),
            expected_config_revision: z.number(),
          }),
          fields: z.object({
            config: z.object({
              ordinary_workflow: z.object({ statuses: z.array(z.object({ label: z.string() })) }),
            }),
          }),
        }),
      )
      .parse(stored);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      key: `configuration:${slug}`,
      base: { database_epoch: epoch, expected_revision: 1, expected_config_revision: 1 },
    });
    expect(drafts[0]?.fields.config.ordinary_workflow.statuses[0]?.label).toBe(proposedLabel);
    await page.reload();
    await expect(label).toHaveValue(proposedLabel);
    const saved = successEnvelopeSchema.parse(
      await (await page.request.get(`${server.origin}/api/v1/projects/${slug}/config`)).json(),
    );
    expect(saved.data).toMatchObject({
      revision: 1,
      ordinary_workflow: {
        statuses: expect.arrayContaining([
          expect.objectContaining({ id: 'idea', label: originalLabel }),
        ]),
      },
    });
    expect(
      server.fixture.connection.sqlite
        .prepare("SELECT count(*) FROM operation_receipts WHERE operation = 'config.migrate'")
        .pluck()
        .get(),
    ).toBe(0);
    expect(migrations).toBe(0);
  } finally {
    await page.context().close();
    await server.close();
  }
});
