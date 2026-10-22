import { expect, test } from '@playwright/test';
import { z } from 'zod/mini';
import { mutationEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { offlineBrowserServer, loadedTask } from '../fixtures/offline-browser.js';

test('an open transition consent stays disabled offline, retains its text and saves only after explicit online confirmation', async ({
  page,
  context,
}) => {
  const server = await offlineBrowserServer();
  try {
    const path = `/projects/alpha/tasks/${server.taskId}/transitions`;
    let revision = 1;
    for (const status of ['planning', 'ready', 'in_progress', 'sanity_check']) {
      const result = await server.request('http', {
        command: [],
        path,
        method: 'POST',
        input: server.envelope({ to_status_id: status }, { expected_revision: revision }),
      });
      expect(result.status, JSON.stringify(result.envelope)).toBe(200);
      revision = z
        .object({ revision: z.int() })
        .parse(successEnvelopeSchema.parse(result.envelope).data).revision;
    }
    await loadedTask(page, server);
    await page.getByRole('button', { name: 'Завершить: Готово', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const field = dialog.getByLabel('Текст подтверждения', { exact: true });
    const confirm = dialog.getByRole('button', { name: 'Подтвердить', exact: true });
    const text = '  Проверено лично 👩🏽‍💻.\nСохранить мой текст подтверждения точно.  ';
    await field.fill(text);
    await expect(confirm).toBeEnabled();
    const before = server.snapshot();
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/v1/'))
        writes.push(request.url());
    });
    await context.setOffline(true);
    await expect(confirm).toBeDisabled();
    await expect(dialog).toBeVisible();
    await expect(field).toHaveValue(text);
    expect(writes).toEqual([]);
    expect(server.snapshot()).toEqual(before);
    await context.setOffline(false);
    await expect(confirm).toBeEnabled();
    await expect(field).toHaveValue(text);
    expect(writes).toEqual([]);
    expect(server.snapshot()).toEqual(before);
    const completed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1${path}`,
    );
    await confirm.click();
    const response = await completed;
    expect(response.status()).toBe(200);
    const body = mutationEnvelopeSchema.parse(response.request().postDataJSON());
    expect(body.payload).toEqual({
      to_status_id: 'done',
      confirmation: { asserted: true, user_text: text },
    });
    await expect(dialog).not.toBeVisible();
    expect(writes).toEqual([`${server.origin}/api/v1${path}`]);
    expect(
      server.inspect((sqlite) =>
        sqlite.prepare('SELECT status_id,revision FROM tasks WHERE id=?').get(server.taskId),
      ),
    ).toEqual({ status_id: 'done', revision: revision + 1 });
    const audit = z
      .array(z.strictObject({ actor: z.string(), confirmation: z.string() }))
      .parse(
        server.inspect((sqlite) =>
          sqlite
            .prepare(
              "SELECT actor,confirmation FROM audit_records WHERE operation_id=? AND action='task.transition'",
            )
            .all(body.operation_id),
        ),
      );
    expect(audit).toEqual([
      { actor: 'human-web', confirmation: JSON.stringify({ asserted: true, user_text: text }) },
    ]);
    expect(
      server.inspect((sqlite) =>
        sqlite
          .prepare('SELECT COUNT(*) AS count FROM operation_receipts WHERE operation_id=?')
          .get(body.operation_id),
      ),
    ).toEqual({ count: 1 });
  } finally {
    await context.setOffline(false);
    await page.close();
    await server.close();
  }
});
