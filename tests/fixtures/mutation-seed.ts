import { randomUUID } from 'node:crypto';
import { z } from 'zod/mini';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createDatabaseFixture } from './database.js';
import { createTestClock } from './clock.js';
export async function createMutationFixture() {
  const clock = createTestClock(Date.UTC(2026, 9, 21, 10, 0, 0, 123));
  let connection: ReturnType<typeof openDatabase> | undefined;
  const fixture = await createDatabaseFixture(
    {
      acquireDatabaseLock,
      releaseDatabaseLock,
      openDatabase(input) {
        connection = openDatabase(input);
        return connection;
      },
      migrateDatabase,
    },
    clock,
  );
  if (connection === undefined) throw new Error('Production database fixture did not open');
  try {
    const ids = { alpha: randomUUID(), beta: randomUUID(), betaTask: randomUUID() };
    const insertProject = connection.sqlite.prepare(`
      INSERT INTO projects
        (id, slug, name, description, emoji, emoji_key, priority, revision,
         config_revision, created_at, updated_at)
      VALUES (?, ?, ?, '', ?, ?, 0, 1, 1, ?, ?)
    `);
    const insertConfig = connection.sqlite.prepare(`
      INSERT INTO project_configs
        (project_slug, revision, priority_model, ordinary_workflow, recurring_workflow,
         semantic_snapshot, effective_at, actor)
      VALUES (?, 1, '{}', '{}', '{}', '{}', ?, 'human-web')
    `);
    for (const [slug, id, emoji] of [
      ['alpha', ids.alpha, '🔵'],
      ['beta', ids.beta, '🟢'],
    ]) {
      insertProject.run(id, slug, slug, emoji, emoji, clock.now(), clock.now());
      insertConfig.run(slug, clock.now());
    }
    connection.sqlite
      .prepare(
        `
      INSERT INTO tasks
        (id, project_slug, kind, title, description, description_html, emoji, emoji_key,
         status_id, revision, created_at, updated_at)
      VALUES (?, 'beta', 'ordinary', 'Owned by beta', '', '', '⚪', '⚪', 'idea', 1, ?, ?)
    `,
      )
      .run(ids.betaTask, clock.now(), clock.now());
    const state = z
      .object({ database_epoch: z.uuid() })
      .parse(
        connection.sqlite
          .prepare('SELECT database_epoch FROM application_state WHERE id = 1')
          .get(),
      );
    return { ...fixture, connection, clock, ids, epoch: state.database_epoch };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
export type MutationFixture = Awaited<ReturnType<typeof createMutationFixture>>;
/** Observable durable state, including receipts/audit/read revision, for rejection checks. */
export function mutationSnapshot(fixture: MutationFixture) {
  return {
    projects: fixture.connection.sqlite.prepare('SELECT * FROM projects ORDER BY slug').all(),
    tasks: fixture.connection.sqlite.prepare('SELECT * FROM tasks ORDER BY id').all(),
    state: fixture.connection.sqlite.prepare('SELECT * FROM application_state').all(),
    audits: fixture.connection.sqlite.prepare('SELECT * FROM audit_records ORDER BY id').all(),
    receipts: fixture.connection.sqlite
      .prepare('SELECT * FROM operation_receipts ORDER BY operation_id')
      .all(),
    reservations: fixture.connection.sqlite
      .prepare('SELECT * FROM project_emoji_reservations ORDER BY emoji_key')
      .all(),
  };
}
