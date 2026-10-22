import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { z } from 'zod/mini';
import { RENDER_POLICY_VERSION, renderMarkdown } from '../../src/core/markdown/render.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import {
  createOrdinaryFixture,
  initialWork,
  ordinaryInput,
  ordinarySnapshot,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
function authoritativeSnapshot(fixture: OrdinaryFixture) {
  return Object.fromEntries(
    Object.entries(ordinarySnapshot(fixture)).map(([table, rows]) => [
      table,
      rows.map((value) => {
        const row = z.record(z.string(), jsonValueSchema).parse(value);
        return Object.fromEntries(
          Object.entries(row).filter(([field]) => {
            if (table === 'tasks')
              return !['description_html', 'render_policy_version'].includes(field);
            return table !== 'application_state' || field !== 'read_revision';
          }),
        );
      }),
    ]),
  );
}
it('explicit compiled migration refreshes obsolete HTML without changing authoritative source/history', async () => {
  const fixture = await createOrdinaryFixture();
  try {
    const { api, task } = await initialWork(fixture);
    const source = '**Сохранить источник**\n\n<script>obsolete()</script>';
    api.updateTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, { description: source }, { revision: task.revision }),
    );
    fixture.connection.sqlite
      .prepare('UPDATE tasks SET description_html=?,render_policy_version=? WHERE id=?')
      .run('<script>obsolete()</script>', RENDER_POLICY_VERSION + 1, task.id);
    const before = authoritativeSnapshot(fixture);
    const state = () =>
      z
        .object({ read_revision: z.number() })
        .parse(
          fixture.connection.sqlite.prepare('SELECT read_revision FROM application_state').get(),
        ).read_revision;
    const revision = state();
    const result = spawnSync(process.execPath, ['dist/migrate.js'], {
      env: { ...process.env, AI_TASKS_DB_PATH: fixture.path },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(
      fixture.connection.sqlite
        .prepare('SELECT description_html,render_policy_version FROM tasks WHERE id=?')
        .get(task.id),
    ).toEqual({
      description_html: renderMarkdown(source),
      render_policy_version: RENDER_POLICY_VERSION,
    });
    expect(state()).toBe(revision + 1);
    expect(authoritativeSnapshot(fixture)).toEqual(before);
  } finally {
    await fixture.close();
  }
});
