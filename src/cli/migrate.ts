import { openDatabase } from '../core/database/open.js';
import { migrateDatabase } from '../core/database/migrate.js';
import { refreshRenderedDescriptions } from '../core/markdown/render.js';
import { runLocked } from '../runtime/locked-entry.js';

try {
  await runLocked(
    { databasePath: process.env.AI_TASKS_DB_PATH ?? './data/ai-tasks.sqlite', mode: 'shared' },
    (lock) => {
      const connection = openDatabase({ path: lock.databasePath, lock });
      try {
        migrateDatabase(connection);
        refreshRenderedDescriptions(connection);
        process.stdout.write(`${JSON.stringify({ ok: true, schema_version: 1 })}\n`);
      } finally {
        connection.close();
      }
    },
  );
} catch {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: { code: 'MIGRATION_FAILED', message: 'Database migration failed' } })}\n`,
  );
  process.exitCode = 1;
}
