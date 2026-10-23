import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { z } from 'zod/mini';
import { createTask, archiveTask } from '../../src/core/tasks/commands.js';
import { createProject, archiveProject } from '../../src/core/projects/commands.js';
import { addDependency } from '../../src/core/tasks/dependencies.js';
import { controlRecurrence } from '../../src/core/recurrence/control.js';
import { ordinaryInput } from './ordinary-work.js';
import { createRecoveryHarness } from './recovery-transport.js';
import { closeTaskActions, leaveWithDraft, openSavedDescription } from './task-ui.js';

export const cachedTitle = 'Офлайн: сохранить исходник 👩🏽‍💻';
export const cachedSource =
  '  # Инструкция\n\n**Сохранить точно** 👩🏽‍💻\n\n<script>globalThis.offlineAttack=1</script>\n\n[Опасная ссылка](javascript:alert(1))\n\n```text\n' +
  'длинная_строка_'.repeat(60) +
  '\n```\n';
const identity = z.object({ id: z.uuid(), revision: z.number() });
export async function offlineBrowserServer() {
  let taskId = '';
  let uncachedId = '';
  let recurringId = '';
  let archivedId = '';
  let dependentId = '';
  const server = await createRecoveryHarness({
    seed(fixture) {
      taskId = identity.parse(
        createTask(
          fixture.human,
          'alpha',
          ordinaryInput(fixture, {
            kind: 'ordinary',
            title: cachedTitle,
            description: cachedSource,
          }),
        ).data,
      ).id;
      uncachedId = identity.parse(
        createTask(
          fixture.human,
          'alpha',
          ordinaryInput(fixture, {
            kind: 'ordinary',
            title: 'Никогда не загруженная задача',
          }),
        ).data,
      ).id;
      const archived = identity.parse(
        createTask(
          fixture.human,
          'alpha',
          ordinaryInput(fixture, {
            kind: 'ordinary',
            title: 'Архивная задача для восстановления',
          }),
        ).data,
      );
      archivedId = archived.id;
      archiveTask(
        fixture.human,
        'alpha',
        archivedId,
        ordinaryInput(fixture, {}, { revision: archived.revision }),
      );
      const dependent = identity.parse(
        createTask(
          fixture.human,
          'alpha',
          ordinaryInput(fixture, {
            kind: 'ordinary',
            title: 'Задача с предварительным условием',
          }),
        ).data,
      );
      dependentId = dependent.id;
      addDependency(
        fixture.human,
        'alpha',
        dependentId,
        ordinaryInput(
          fixture,
          {
            prerequisite_task_id: uncachedId,
            prerequisite_project_slug: 'alpha',
          },
          { revision: dependent.revision },
        ),
      );
      createProject(
        fixture.human,
        'archived',
        ordinaryInput(
          fixture,
          {
            slug: 'archived',
            name: 'Архивный проект',
            emoji: '🧱',
          },
          { projectSlug: 'archived' },
        ),
      );
      archiveProject(
        fixture.human,
        'archived',
        ordinaryInput(
          fixture,
          { affected_tasks: [] },
          {
            projectSlug: 'archived',
            revision: 1,
          },
        ),
      );
      const recurrence = {
        first_deadline: new Date(Date.now() + 86400000).toISOString(),
        schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '13:00:00.000' },
        miss_policy: 'carry_forward',
        confirmation_window_ms: 0,
      };
      const created = identity.parse(
        createTask(fixture.human, 'alpha', {
          ...ordinaryInput(fixture, { kind: 'recurring', title: 'Офлайн-повторения', recurrence }),
          expected_settings_revision: 1,
        }).data,
      );
      recurringId = created.id;
      const active = identity.parse(
        controlRecurrence(fixture.human, 'alpha', recurringId, {
          ...ordinaryInput(fixture, { to_status_id: 'active' }, { revision: created.revision }),
          expected_settings_revision: 1,
        }).data,
      );
      controlRecurrence(fixture.human, 'alpha', recurringId, {
        ...ordinaryInput(fixture, { to_status_id: 'paused' }, { revision: active.revision }),
        expected_settings_revision: 1,
      });
    },
  });
  return { ...server, taskId, uncachedId, recurringId, archivedId, dependentId };
}
export type OfflineBrowserServer = Awaited<ReturnType<typeof offlineBrowserServer>>;
export const taskPath = (id: string) => `/projects/alpha/tasks/${id}`;
export async function loadedTask(page: Page, server: OfflineBrowserServer) {
  await leaveWithDraft(page, () => page.goto(`${server.origin}${taskPath(server.taskId)}`));
  await expect(page.getByRole('heading', { name: cachedTitle, exact: true })).toBeVisible();
  const description = await openSavedDescription(page);
  await expect(description).toContainText('Сохранить точно');
  await closeTaskActions(page);
  await expect(page.getByLabel('Описание', { exact: true })).toBeVisible();
}
export async function offlineNavigation(page: Page, path?: string) {
  // A failed cold navigation is the behavior under test, not a fixture setup failure.
  await leaveWithDraft(page, async () => {
    if (path) await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    else await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
  });
}
export async function waitForDraft(page: Page, id: string, text: string) {
  await expect
    .poll(async () => {
      const value: unknown = await page.evaluate(`new Promise((resolve,reject)=>{
      const request=indexedDB.open('ai-tasks-browser-drafts');
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result;
        if(!db.objectStoreNames.contains('draft-records')){db.close();resolve(null);return;}
        const tx=db.transaction('draft-records','readonly');
        const read=tx.objectStore('draft-records').get(${JSON.stringify(`task:alpha:${id}`)});
        read.onsuccess=()=>resolve(read.result??null);read.onerror=()=>reject(read.error);
        tx.oncomplete=()=>db.close();};})`);
      const draft = z.object({ fields: z.object({ description: z.string() }) }).safeParse(value);
      return draft.success ? draft.data.fields.description : '';
    })
    .toBe(text);
}
export async function competingCliEdit(server: OfflineBrowserServer, description: string) {
  const result = await server.request('cli', {
    command: ['task', 'update', server.taskId],
    path: `/projects/alpha/tasks/${server.taskId}`,
    project: 'alpha',
    method: 'POST',
    input: {
      operation_id: randomUUID(),
      database_epoch: server.epoch,
      expected_config_revision: 1,
      expected_revision: 1,
      description,
    },
  });
  expect(result.status, JSON.stringify(result.envelope)).toBe(0);
}
