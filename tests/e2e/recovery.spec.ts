import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { mutationEnvelopeSchema } from '../../src/schema/envelopes.js';
import {
  backupInfo,
  createRecoveryHarness,
  recoveryJob,
  successfulRecovery,
  type RecoveryHarness,
} from '../fixtures/recovery-transport.js';
import {
  installBrowserResponseLoss,
  waitForBrowserResponseLoss,
} from '../fixtures/browser-response-loss.js';

async function createBackup(server: RecoveryHarness) {
  const response = await server.request('http', {
    command: [],
    path: '/projects/alpha/backups',
    method: 'POST',
    project: 'alpha',
    input: server.envelope(),
  });
  expect(response.status, JSON.stringify(response.envelope)).toBe(201);
  return backupInfo.parse(successfulRecovery(response));
}
async function openBackups(page: Page, server: RecoveryHarness) {
  await page.goto(`${server.origin}/backups`);
  await expect(page.getByRole('heading', { name: 'Резервные копии', exact: true })).toBeVisible();
  await page.getByLabel('Проект для записи изменения', { exact: true }).selectOption('alpha');
}
async function validateBackup(page: Page, id: string) {
  await expect(page.getByText(id, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Проверить снимок', exact: true }).click();
  const union = page.getByRole('region', { name: 'Затронутые проекты', exact: true });
  await expect(union).toContainText('alpha');
  return union;
}
async function confirmRestore(page: Page) {
  await page.getByRole('button', { name: 'Восстановить снимок', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('alpha');
  await expect(dialog).toContainText(/всю базу|все проекты/iu);
  const confirm = dialog.getByRole('button', { name: 'Подтвердить восстановление', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog
    .getByLabel('Текст подтверждения', { exact: true })
    .fill('Восстановить весь снимок, сохранив историю.');
  return confirm;
}
test('managed backups use explicit project scope, complete revision review and mobile-safe ID controls', async ({
  page,
}) => {
  const server = await createRecoveryHarness();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const before = server.snapshot();
    await openBackups(page, server);
    const create = page.waitForResponse(
      (response) =>
        response.url().endsWith('/projects/alpha/backups') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Создать резервную копию', exact: true }).click();
    const created = await create;
    expect(created.status()).toBe(201);
    const input = mutationEnvelopeSchema.parse(created.request().postDataJSON());
    expect(input).toMatchObject({
      database_epoch: server.epoch,
      expected_config_revision: 1,
      expected_settings_revision: 1,
      payload: {},
    });
    const info = backupInfo.parse(
      successfulRecovery({ status: 201, envelope: await created.json() }),
    );
    const union = await validateBackup(page, info.id);
    await expect(union).toContainText(/ревизия.*1/iu);
    await expect(union).toContainText(/конфигурац.*1/iu);
    expect(await page.locator('input[type=file]').count()).toBe(0);
    await expect(page.getByText(server.directory, { exact: false })).toHaveCount(0);
    const confirm = await confirmRestore(page);
    await expect(confirm).toBeEnabled();
    const target = await confirm.boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    for (const width of [390, 1100]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = await page.locator('main').boundingBox();
      expect(bounds?.width).toBeLessThanOrEqual(430);
      const overflow: unknown = await page.evaluate(
        'document.documentElement.scrollWidth > innerWidth',
      );
      expect(overflow).toBe(false);
    }
    expect(server.snapshot()).toEqual(before);
  } finally {
    await page.context().close();
    await server.close();
  }
});
test('lost restore acceptance resolves through operation status during maintenance and preserves the old-epoch draft', async ({
  page,
}) => {
  const server = await createRecoveryHarness();
  let held: ReturnType<typeof acquireDatabaseLock> | undefined;
  try {
    const info = await createBackup(server);
    await page.goto(`${server.origin}/projects/alpha/tasks/${server.taskId}`);
    await expect(page.getByLabel('Название задачи', { exact: true })).toBeVisible();
    const draft = '  **Неотправленный черновик** 👩🏽‍💻\n\nСохранить после явной сверки.';
    await page.getByLabel('Описание', { exact: true }).fill(draft);
    await page
      .getByLabel('Название задачи', { exact: true })
      .fill('Мой черновик после восстановления');
    const readDraft = `new Promise((resolve, reject) => {
      const opened = indexedDB.open('ai-tasks-browser-drafts');
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const db = opened.result;
        const transaction = db.transaction('draft-records', 'readonly');
        const request = transaction.objectStore('draft-records').get(${JSON.stringify(`task:alpha:${server.taskId}`)});
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    })`;
    await expect
      .poll(async () => page.evaluate(readDraft))
      .toMatchObject({
        fields: { description: draft, title: 'Мой черновик после восстановления' },
        base: { database_epoch: server.epoch, expected_revision: 1 },
      });
    await openBackups(page, server);
    await validateBackup(page, info.id);
    const confirm = await confirmRestore(page);
    held = acquireDatabaseLock({ databasePath: server.path, mode: 'shared' });
    const path = '/api/v1/projects/alpha/backups/restore';
    const bodies: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== path) return;
      const body = request.postData();
      if (body !== null) bodies.push(body);
    });
    await installBrowserResponseLoss(page, { method: 'POST', path });
    await confirm.click();
    const response = await waitForBrowserResponseLoss(page);
    expect(response.status).toBe(202);
    expect(response.url).toBe(`${server.origin}${path}`);
    expect(bodies).toHaveLength(1);
    const input = mutationEnvelopeSchema.parse(JSON.parse(bodies[0] ?? 'null'));
    const operationId = input.operation_id;
    const accepted = recoveryJob.parse(
      successfulRecovery({ status: 202, envelope: JSON.parse(response.body) }),
    );
    expect(accepted.operation_id).toBe(operationId);
    const jobId = accepted.job_id;
    expect(jobId).not.toBe('');
    await expect(
      page.getByRole('button', { name: 'Проверить состояние операции', exact: true }),
    ).toBeVisible();
    const lookup = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/backups/jobs' &&
        new URL(response.url()).searchParams.get('operation_id') === operationId,
    );
    await page.getByRole('button', { name: 'Проверить состояние операции', exact: true }).click();
    expect((await lookup).status()).toBe(200);
    await expect(
      page.getByRole('status').filter({ hasText: /восстановлен|обслуживан/iu }),
    ).toBeVisible();
    const metadata = await page.request.get(`${server.origin}/api/v1/meta?all_projects=true`);
    expect(metadata.status()).toBe(503);
    releaseDatabaseLock(held);
    held = undefined;
    await expect(
      page.getByRole('status').filter({ hasText: /восстановление завершено/iu }),
    ).toBeVisible();
    const current = await server.request('http', { command: [], path: '/meta?all_projects=true' });
    expect(current.envelope.ok && current.envelope.meta.database_epoch).not.toBe(server.epoch);
    expect(bodies).toHaveLength(1);
    let writes = 0;
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().includes(`/tasks/${server.taskId}`))
        writes += 1;
    });
    await page.goto(`${server.origin}/projects/alpha/tasks/${server.taskId}`);
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(draft);
    await expect(page.getByLabel('Название задачи', { exact: true })).toHaveValue(
      'Мой черновик после восстановления',
    );
    await expect(page.getByRole('alert').filter({ hasText: /баз|эпох|восстанов/iu })).toBeVisible();
    expect(writes).toBe(0);
    expect(
      server.inspect((sqlite) =>
        sqlite.prepare('SELECT description FROM tasks WHERE id=?').get(server.taskId),
      ),
    ).toEqual({ description: '  **Исходник** 👩🏽‍💻\n\nСохранить точно.' });
  } finally {
    if (held) releaseDatabaseLock(held);
    await page.context().close();
    await server.close();
  }
});
test('post-backup permanent marker conflicts remain visible and prevent restore without rewriting saved data', async ({
  page,
}) => {
  const server = await createRecoveryHarness();
  try {
    // Use the real PATCH endpoint directly; no intercepted responses or fixture SQL edits.
    const patch = async (path: string, payload: unknown, revision: number) => {
      const response = await page.request.patch(`${server.origin}/api/v1${path}`, {
        headers: { Origin: server.origin, 'X-AI-Tasks-Mutation': '1' },
        data: {
          operation_id: randomUUID(),
          database_epoch: server.epoch,
          expected_revision: revision,
          expected_config_revision: 1,
          payload,
        },
      });
      expect(response.status(), await response.text()).toBe(200);
    };
    await patch(`/projects/alpha/tasks/${server.taskId}`, { emoji: '🧪' }, 1);
    const info = await createBackup(server);
    await patch(`/projects/alpha/tasks/${server.taskId}`, { emoji: '⚪' }, 2);
    await patch('/projects/alpha', { emoji: '🧪' }, 1);
    const before = server.snapshot();
    await openBackups(page, server);
    const checked = page.waitForResponse((response) =>
      response.url().endsWith(`/backups/${info.id}/validate`),
    );
    await page.getByRole('button', { name: 'Проверить снимок', exact: true }).click();
    const refused = await checked;
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: {
        code: 'EMOJI_CONFLICT',
        details: {
          conflicts: [
            {
              reason: 'task_marker_collision',
              reservation_project_slug: 'alpha',
              conflicting_project_slug: 'alpha',
              entity_id: server.taskId,
            },
          ],
        },
      },
    });
    await expect(page.getByRole('alert')).toContainText('alpha');
    await expect(page.getByRole('alert')).toContainText(server.taskId);
    await expect(
      page.getByRole('button', { name: 'Восстановить снимок', exact: true }),
    ).toBeDisabled();
    expect(server.snapshot()).toEqual(before);
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('canceling restore consent while draft persistence is pending never starts recovery', async ({
  page,
}) => {
  const server = await createRecoveryHarness();
  const restoreRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/backups/restore'))
      restoreRequests.push(request.postData() ?? '');
  });
  try {
    await page.addInitScript(`(() => {
      const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
      if (!descriptor?.set) throw new Error('Missing IndexedDB completion descriptor');
      globalThis.backupDraftHold = false;
      globalThis.backupDraftHeld = [];
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
        ...descriptor,
        set(handler) {
          if (typeof handler !== 'function') return descriptor.set.call(this, handler);
          descriptor.set.call(this, event => {
            const complete = () => handler.call(this, event);
            if (this.db.name === 'ai-tasks-browser-drafts' && this.mode === 'readwrite' && globalThis.backupDraftHold)
              globalThis.backupDraftHeld.push(complete);
            else complete();
          });
        },
      });
    })()`);
    const info = await createBackup(server);
    await openBackups(page, server);
    await validateBackup(page, info.id);
    const before = server.snapshot();
    for (const dismissal of ['escape', 'outside', 'button']) {
      const confirm = await confirmRestore(page);
      await page.evaluate('globalThis.backupDraftHold = true');
      await confirm.click();
      await expect
        .poll(() => page.evaluate('globalThis.backupDraftHeld.length'))
        .toBeGreaterThan(0);
      if (dismissal === 'escape') await page.keyboard.press('Escape');
      else if (dismissal === 'outside') await page.mouse.click(2, 2);
      else
        await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
      await page.evaluate(`(() => {
        globalThis.backupDraftHold = false;
        for (const complete of globalThis.backupDraftHeld.splice(0)) complete();
      })()`);
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await page.getByRole('button', { name: 'Восстановить снимок', exact: true }).click();
      await expect(
        page.getByRole('dialog').getByLabel('Текст подтверждения', { exact: true }),
      ).toHaveValue('');
      await expect(
        page
          .getByRole('dialog')
          .getByRole('button', { name: 'Подтвердить восстановление', exact: true }),
      ).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();
      expect(restoreRequests).toEqual([]);
      expect(server.snapshot()).toEqual(before);
    }
  } finally {
    await page.context().close();
    await server.close();
  }
});
