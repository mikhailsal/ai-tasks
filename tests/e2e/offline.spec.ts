import { expect, test } from '@playwright/test';
import { z } from 'zod/mini';
import {
  mutationEnvelopeSchema,
  mutationSuccessEnvelopeSchema,
} from '../../src/schema/envelopes.js';
import {
  backupValidation,
  recoveryJob,
  successfulRecovery,
  waitRecoveryJob,
} from '../fixtures/recovery-transport.js';
import {
  cachedTitle,
  cachedSource,
  offlineBrowserServer,
  loadedTask,
  offlineNavigation,
  taskPath,
  waitForDraft,
  competingCliEdit,
} from '../fixtures/offline-browser.js';

import {
  installBrowserResponseLoss,
  observeBrowserMutationBodies,
  waitForBrowserResponseLoss,
} from '../fixtures/browser-response-loss.js';

const savedTime = /Последнее успешное обновление/u;
const cacheMiss = /не сохранен[аоы]?|нет сохранённых данных|нет данных в кэше|нет данных в кеше/iu;

test('cold offline reload and reopening retain the latest fetched safe HTML and exact source without artificial expiry', async ({
  page,
  context,
}) => {
  const server = await offlineBrowserServer();
  try {
    await loadedTask(page, server);
    await page.getByText('Исходник Markdown', { exact: true }).click();
    expect(
      await page
        .getByText('Исходник Markdown', { exact: true })
        .locator('..')
        .locator('pre')
        .textContent(),
    ).toBe(cachedSource);
    await page.evaluate('navigator.serviceWorker.ready.then(() => undefined)');
    await context.setOffline(true);
    await offlineNavigation(page);
    await expect(page.getByRole('heading', { name: cachedTitle, exact: true })).toBeVisible();
    await expect(page.getByText(/Нет соединения/u).first()).toBeVisible();
    await expect(page.getByText(savedTime).first()).toBeVisible();
    const saved = await page.getByText(savedTime).first().locator('time').getAttribute('datetime');
    expect(saved).not.toBeNull();
    const html = page.getByRole('region', { name: 'Описание задачи', exact: true });
    await expect(html).toContainText('Сохранить точно');
    await expect(html.locator('script,img,[onerror],a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate('globalThis.offlineAttack ?? null')).toBeNull();
    await page.getByText('Исходник Markdown', { exact: true }).click();
    expect(
      await page
        .getByText('Исходник Markdown', { exact: true })
        .locator('..')
        .locator('pre')
        .textContent(),
    ).toBe(cachedSource);
    const path = page.url();
    await page.close();
    const reopened = await context.newPage();
    await reopened.clock.setFixedTime(Date.now() + 60 * 86400000);
    await offlineNavigation(reopened, path);
    await expect(reopened.getByRole('heading', { name: cachedTitle, exact: true })).toBeVisible();
    await expect(reopened.getByText(savedTime).first().locator('time')).toHaveAttribute(
      'datetime',
      saved ?? '',
    );
    await expect(
      reopened.getByRole('button', { name: 'Редактировать', exact: true }),
    ).toBeDisabled();
    await reopened.close();
  } finally {
    await context.setOffline(false);
    await page.context().close();
    await server.close();
  }
});

test('uncached detail and evicted read snapshots explain absence instead of inventing empty or fresh data', async ({
  page,
  context,
}) => {
  const server = await offlineBrowserServer();
  try {
    await loadedTask(page, server);
    await expect(page.getByText(savedTime).first()).toBeVisible();
    await context.setOffline(true);
    await offlineNavigation(page, `${server.origin}${taskPath(server.uncachedId)}`);
    await expect(page.getByText(cacheMiss).first()).toBeVisible();
    await expect(page.getByText('Никогда не загруженная задача', { exact: true })).toHaveCount(0);
    await context.setOffline(false);
    await loadedTask(page, server);
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await page.getByLabel('Описание', { exact: true }).fill('Черновик отдельно от снимков');
    await waitForDraft(page, server.taskId, 'Черновик отдельно от снимков');
    await page.evaluate(`(async()=>{for(const entry of await indexedDB.databases()){
      if(entry.name && entry.name!=='ai-tasks-browser-drafts')await new Promise((resolve,reject)=>{
        const request=indexedDB.open(entry.name);request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{const db=request.result;const names=[...db.objectStoreNames];
          if(!names.length){db.close();resolve();return;}
          const tx=db.transaction(names,'readwrite');for(const name of names)tx.objectStore(name).clear();
          tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};});}})()`);
    await context.setOffline(true);
    await offlineNavigation(page);
    await expect(page.getByText(cacheMiss).first()).toBeVisible();
    await expect(page.getByText(/Последнее успешное обновление.*сейчас/u)).toHaveCount(0);
    await context.setOffline(false);
    await loadedTask(page, server);
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
      'Черновик отдельно от снимков',
    );
  } finally {
    await context.setOffline(false);
    await page.context().close();
    await server.close();
  }
});

test('a real read-cache quota failure is visible, keeps the online result and never claims an offline copy was saved', async ({
  page,
  context,
}) => {
  const server = await offlineBrowserServer();
  try {
    await page.addInitScript(`(()=>{const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){
        if(sessionStorage.getItem('fail-read-cache')==='yes'&&this.transaction.db.name!=='ai-tasks-browser-drafts')
          throw new DOMException('Read cache quota exhausted','QuotaExceededError');
        return put.apply(this,args);};})();`);
    await loadedTask(page, server);
    await expect(page.getByText(savedTime).first()).toBeVisible();
    await page.evaluate("sessionStorage.setItem('fail-read-cache','yes')");
    await page.goto(`${server.origin}${taskPath(server.uncachedId)}`);
    await expect(
      page.getByRole('heading', { name: 'Никогда не загруженная задача', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /хранилищ|кэш|кеш/iu })
        .first(),
    ).toBeVisible();
    await context.setOffline(true);
    await offlineNavigation(page);
    await expect(page.getByText(cacheMiss).first()).toBeVisible();
    await offlineNavigation(page, `${server.origin}${taskPath(server.taskId)}`);
    await expect(page.getByRole('heading', { name: cachedTitle, exact: true })).toBeVisible();
  } finally {
    await context.setOffline(false);
    await page.context().close();
    await server.close();
  }
});

test('every write family remains disabled offline and reconnecting never queues a command', async ({
  page,
  context,
}) => {
  const server = await offlineBrowserServer();
  try {
    const backup = await server.request('http', {
      command: [],
      path: '/projects/alpha/backups',
      method: 'POST',
      input: server.envelope(),
    });
    expect(backup.status).toBe(201);
    const routes = [
      { path: '/projects/alpha', buttons: ['Редактировать проект', 'Архивировать проект'] },
      { path: '/projects/alpha/tasks/new', buttons: ['Сохранить'] },
      {
        path: taskPath(server.taskId),
        buttons: ['Редактировать', 'В архив', 'Добавить зависимость'],
      },
      {
        path: taskPath(server.dependentId),
        buttons: ['Добавить зависимость', 'Удалить зависимость'],
      },
      { path: taskPath(server.archivedId), buttons: ['Восстановить'] },
      { path: '/projects/archived', buttons: ['Восстановить'] },
      {
        path: '/projects/alpha/configuration',
        buttons: ['Предпросмотр изменений', 'Применить изменения'],
      },
      {
        path: taskPath(server.recurringId),
        buttons: [
          'Обработать наступившие сроки',
          'Изменить повторение',
          'Выполнить выбранные',
          'Отменить выбранные',
        ],
      },
      { path: '/settings?project_slug=alpha', buttons: ['Сохранить часовой пояс'] },
      { path: '/backups?project_slug=alpha', buttons: ['Создать резервную копию'] },
    ];
    for (const route of routes) {
      await page.goto(`${server.origin}${route.path}`);
      for (const name of route.buttons)
        await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
      if (route.path === taskPath(server.recurringId)) {
        await page
          .getByRole('checkbox', { name: /^Выбрать повторение /u })
          .first()
          .check();
        await page
          .getByLabel('Причина отмены', { exact: true })
          .fill('Отмена будет разрешена только онлайн');
        await expect(
          page.getByRole('button', { name: 'Выполнить выбранные', exact: true }),
        ).toBeEnabled();
        await expect(
          page.getByRole('button', { name: 'Отменить выбранные', exact: true }),
        ).toBeEnabled();
      }
    }
    const before = server.snapshot();
    const writes: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/v1/') && request.method() !== 'GET')
        writes.push(request.url());
    });
    await context.setOffline(true);
    for (const route of routes) {
      await offlineNavigation(page, `${server.origin}${route.path}`);
      for (const name of route.buttons)
        await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
      for (const button of await page
        .getByRole('region', { name: 'Действия с задачей', exact: true })
        .getByRole('button')
        .all())
        await expect(button).toBeDisabled();
    }
    for (let index = 0; index < 3; index += 1) {
      await context.setOffline(false);
      await context.setOffline(true);
    }
    await context.setOffline(false);
    await expect(page.getByText(/Нет соединения/u)).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(server.snapshot()).toEqual(before);
  } finally {
    await context.setOffline(false);
    await page.context().close();
    await server.close();
  }
});

test('flapping reconnect preserves a dirty draft and its old revision against a competing real CLI edit', async ({
  page,
  context,
}) => {
  const server = await offlineBrowserServer();
  try {
    await loadedTask(page, server);
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    const proposed = 'Мой несохранённый текст\n  **не заменять**  ';
    await page.getByLabel('Описание', { exact: true }).fill(proposed);
    await waitForDraft(page, server.taskId, proposed);
    await context.setOffline(true);
    await competingCliEdit(server, 'Конкурирующий текст CLI');
    await offlineNavigation(page);
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(proposed);
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    for (let index = 0; index < 2; index += 1) {
      await context.setOffline(false);
      await context.setOffline(true);
    }
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(proposed);
    const conflict = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith(`/tasks/${server.taskId}`),
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect((await conflict).status()).toBe(409);
    await expect(page.getByRole('region', { name: 'Текущая версия', exact: true })).toContainText(
      'Конкурирующий текст CLI',
    );
    await expect(page.getByRole('region', { name: 'Ваш вариант', exact: true })).toContainText(
      'Мой несохранённый текст',
    );
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(proposed);
  } finally {
    await context.setOffline(false);
    await page.context().close();
    await server.close();
  }
});

test('a committed lost response survives offline reopening and retries only the identical immutable request', async ({
  page,
  context,
}) => {
  const server = await offlineBrowserServer();
  try {
    const path = `/api/v1/projects/alpha/tasks/${server.taskId}`;
    const bodies = await observeBrowserMutationBodies(page, { method: 'PATCH', path });
    await loadedTask(page, server);
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    const proposed = 'Сохранено один раз, ответ потерян';
    await page.getByLabel('Описание', { exact: true }).fill(proposed);
    await waitForDraft(page, server.taskId, proposed);
    await installBrowserResponseLoss(page, { method: 'PATCH', path });
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const lost = await waitForBrowserResponseLoss(page);
    expect(lost.status).toBe(200);
    expect(lost.url).toBe(`${server.origin}${path}`);
    const receipt = mutationSuccessEnvelopeSchema.parse(JSON.parse(lost.body));
    expect(bodies).toHaveLength(1);
    const original = mutationEnvelopeSchema.parse(JSON.parse(bodies[0] ?? 'null'));
    expect(receipt.meta.operation_id).toBe(original.operation_id);
    await expect(
      page.getByRole('button', { name: 'Повторить ту же операцию', exact: true }),
    ).toBeVisible();
    await context.setOffline(true);
    await offlineNavigation(page);
    const retry = page.getByRole('button', { name: 'Повторить ту же операцию', exact: true });
    await expect(retry).toBeDisabled();
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(proposed);
    await context.setOffline(false);
    await expect(retry).toBeEnabled();
    expect(bodies).toHaveLength(1);
    const replay = page.waitForResponse(
      (reply) => reply.request().method() === 'PATCH' && new URL(reply.url()).pathname === path,
    );
    await retry.click();
    expect(mutationSuccessEnvelopeSchema.parse(await (await replay).json())).toEqual(receipt);
    await expect(retry).toHaveCount(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    const input = mutationEnvelopeSchema.parse(JSON.parse(bodies[0] ?? 'null'));
    expect(
      server.inspect((sqlite) =>
        sqlite
          .prepare('SELECT count(*) FROM operation_receipts WHERE operation_id=?')
          .pluck()
          .get(input.operation_id),
      ),
    ).toBe(1);
    expect(
      server.inspect((sqlite) =>
        sqlite
          .prepare("SELECT count(*) FROM audit_records WHERE entity_id=? AND action='task.update'")
          .pluck()
          .get(server.taskId),
      ),
    ).toBe(1);
    expect(
      server.inspect((sqlite) =>
        sqlite.prepare('SELECT revision FROM tasks WHERE id=?').pluck().get(server.taskId),
      ),
    ).toBe(2);
  } finally {
    await context.setOffline(false);
    await page.context().close();
    await server.close();
  }
});

test('a real restore changes epoch while offline and retains old drafts for explicit review without automatic saves', async ({
  page,
  context,
}) => {
  const server = await offlineBrowserServer();
  try {
    const created = await server.request('http', {
      command: [],
      path: '/projects/alpha/backups',
      method: 'POST',
      input: server.envelope(),
    });
    expect(created.status).toBe(201);
    const backup = z.object({ id: z.uuid() }).parse(successfulRecovery(created));
    await loadedTask(page, server);
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    const proposed = 'Черновик прошлого экземпляра базы';
    await page.getByLabel('Описание', { exact: true }).fill(proposed);
    await waitForDraft(page, server.taskId, proposed);
    await context.setOffline(true);
    await competingCliEdit(server, 'Будет заменён восстановлением');
    const validated = await server.request('http', {
      command: [],
      path: `/backups/${backup.id}/validate`,
      method: 'POST',
      input: { all_projects: true },
    });
    expect(validated.status).toBe(200);
    const checked = backupValidation.parse(successfulRecovery(validated));
    const accepted = await server.request('http', {
      command: [],
      path: '/projects/alpha/backups/restore',
      method: 'POST',
      input: server.envelope({
        backup_id: backup.id,
        affected_projects: checked.affected_projects,
        confirmation: {
          asserted: true,
          user_text: 'Сохранить локальный черновик отдельно от восстановления',
        },
      }),
    });
    expect(accepted.status).toBe(202);
    const job = await waitRecoveryJob(
      server,
      recoveryJob.parse(successfulRecovery(accepted)).job_id,
    );
    expect(job.state).toBe('succeeded');
    expect(job.result?.database_epoch).not.toBe(server.epoch);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().includes('/api/v1/'))
        writes.push(request.url());
    });
    await offlineNavigation(page);
    await context.setOffline(false);
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /баз[аы].*обнов|версия базы|восстановлен|экземпляр базы/iu })
        .first(),
    ).toBeVisible();
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(proposed);
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', {
        name: /Сохранить мой вариант ещё раз|Проверить.*верси|Сверить/iu,
      }),
    ).toBeVisible();
    expect(writes).toEqual([]);
  } finally {
    await context.setOffline(false);
    await page.context().close();
    await server.close();
  }
});
