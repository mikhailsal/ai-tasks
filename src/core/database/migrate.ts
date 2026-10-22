import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { applicationState } from '../../schema/entities.js';
import type { openDatabase } from './open.js';

function migrationsDirectory(): string {
  const candidates = [
    new URL('../../../drizzle/', import.meta.url),
    new URL('../drizzle/', import.meta.url),
  ];
  const directory = candidates.find((url) => existsSync(new URL('meta/_journal.json', url)));
  if (!directory) throw new Error('Production migrations are unavailable');
  return fileURLToPath(directory);
}

export function migrateDatabase(connection: ReturnType<typeof openDatabase>): void {
  migrate(connection.db, { migrationsFolder: migrationsDirectory() });
  connection.db.transaction(
    (transaction) => {
      if (transaction.select().from(applicationState).get()) return;
      const now = connection.now();
      transaction
        .insert(applicationState)
        .values({ databaseEpoch: randomUUID(), createdAt: now, updatedAt: now })
        .run();
    },
    { behavior: 'immediate' },
  );
}
