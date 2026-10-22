import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod/mini';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { projectResourceSchema } from '../../src/schema/projects.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import { offlineBrowserServer } from '../fixtures/offline-browser.js';
import {
  backupInfo,
  backupValidation,
  recoveryJob,
  successfulRecovery,
  waitRecoveryJob,
} from '../fixtures/recovery-transport.js';

function readProjectDraft(page: Page) {
  return page.evaluate(`new Promise((resolve,reject)=>{
    const opened=indexedDB.open('ai-tasks-browser-drafts');
    opened.onerror=()=>reject(opened.error);
    opened.onsuccess=()=>{
      const db=opened.result;
      if(!db.objectStoreNames.contains('draft-records')){db.close();resolve(undefined);return;}
      const transaction=db.transaction('draft-records','readonly');
      const request=transaction.objectStore('draft-records').get('project:alpha');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      transaction.oncomplete=()=>db.close();
      transaction.onabort=()=>{db.close();reject(transaction.error);};
    };
  })`);
}

test('an open project editor survives a real restore and cache refresh with its old draft base until explicit review', async ({
  page,
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
    const backup = backupInfo.parse(successfulRecovery(created));
    const projectResponse = await server.request('http', { command: [], path: '/projects/alpha' });
    expect(projectResponse.status).toBe(200);
    const project = projectResourceSchema.parse(successfulRecovery(projectResponse));
    await page.goto(`${server.origin}/projects/alpha`);
    await page.getByRole('button', { name: 'Редактировать проект', exact: true }).click();
    const form = page.getByRole('form', { name: 'Редактирование проекта', exact: true });
    await expect(form).toBeVisible();
    await form.evaluate((node) => node.setAttribute('data-recovery-mount', 'original'));
    await expect(form).toHaveAttribute('data-recovery-mount', 'original');
    const name = 'Мой несохранённый проект после восстановления';
    const description = '  **Сохранить исходник проекта** 👩🏽‍💻\n\nНе заменять при обновлении базы.';
    await form.getByLabel('Название проекта', { exact: true }).fill(name);
    await form.getByLabel('Описание проекта', { exact: true }).fill(description);
    await expect
      .poll(() => readProjectDraft(page))
      .toMatchObject({
        fields: { name, description },
        base: {
          database_epoch: server.epoch,
          expected_revision: project.revision,
          expected_config_revision: project.config_revision,
        },
      });
    const original = z.object({ base: jsonValueSchema }).parse(await readProjectDraft(page)).base;
    const patches: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        new URL(request.url()).pathname === '/api/v1/projects/alpha'
      )
        patches.push(request.postData() ?? '');
    });
    const metadataResponse = await server.request('http', {
      command: [],
      path: '/meta?all_projects=true',
    });
    expect(metadataResponse.status).toBe(200);
    const metadata = metaEnvelopeSchema.parse(metadataResponse.envelope).data;
    const validationResponse = await server.request('http', {
      command: [],
      path: `/backups/${backup.id}/validate`,
      method: 'POST',
      input: { all_projects: true },
    });
    expect(validationResponse.status).toBe(200);
    const validation = backupValidation.parse(successfulRecovery(validationResponse));
    const accepted = await server.request('http', {
      command: [],
      path: '/projects/alpha/backups/restore',
      method: 'POST',
      input: server.envelope(
        {
          backup_id: backup.id,
          affected_projects: validation.affected_projects,
          confirmation: {
            asserted: true,
            user_text: 'Восстановить снимок, сохранив открытый черновик проекта.',
          },
        },
        {
          database_epoch: metadata.database_epoch,
          expected_config_revision: project.config_revision,
          expected_settings_revision: metadata.settings_revision,
        },
      ),
    });
    expect(accepted.status).toBe(202);
    const terminal = await waitRecoveryJob(
      server,
      recoveryJob.parse(successfulRecovery(accepted)).job_id,
    );
    expect(terminal.state).toBe('succeeded');
    if (terminal.result === null) throw new Error('Successful restore has no result');
    expect(terminal.result.database_epoch).not.toBe(server.epoch);
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    await page.getByRole('button', { name: 'Обновить сохранённые данные', exact: true }).click();
    await expect(form).toHaveAttribute('data-recovery-mount', 'original');
    await expect(form.getByLabel('Название проекта', { exact: true })).toHaveValue(name);
    await expect(form.getByLabel('Описание проекта', { exact: true })).toHaveValue(description);
    await expect(
      form.getByRole('button', { name: 'Сохранить изменения', exact: true }),
    ).toBeDisabled();
    await expect(
      form.getByRole('alert').filter({ hasText: /черновик.*прежн|прежн.*верси/iu }),
    ).toBeVisible();
    await expect(form).toHaveAttribute('data-recovery-mount', 'original');
    expect(z.object({ base: jsonValueSchema }).parse(await readProjectDraft(page)).base).toEqual(
      original,
    );
    expect(patches).toEqual([]);
    expect(navigations).toBe(0);
    const fresh = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/v1/projects/alpha',
    );
    await form.getByRole('button', { name: 'Проверить текущую версию', exact: true }).click();
    const read = await fresh;
    expect(read.status()).toBe(200);
    expect(successEnvelopeSchema.parse(await read.json()).meta.database_epoch).toBe(
      terminal.result.database_epoch,
    );
    await expect(page.getByRole('region', { name: 'Текущая версия', exact: true })).toContainText(
      project.name,
    );
    const proposed = page.getByRole('region', { name: 'Ваш вариант', exact: true });
    await expect(proposed).toContainText(name);
    await expect(proposed).toContainText(description.trim());
    await expect(
      page.getByRole('button', { name: 'Сохранить мой вариант ещё раз', exact: true }),
    ).toBeEnabled();
    await expect(
      form.getByRole('button', { name: 'Сохранить изменения', exact: true }),
    ).toBeDisabled();
    expect(z.object({ base: jsonValueSchema }).parse(await readProjectDraft(page)).base).toEqual(
      original,
    );
    expect(patches).toEqual([]);
    expect(navigations).toBe(0);
  } finally {
    await page.close();
    await server.close();
  }
});
