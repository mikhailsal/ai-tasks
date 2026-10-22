import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { TestClock } from './clock.js';

export interface DatabaseLock {
  databasePath: string;
  lockPath: string;
  fd: number;
  mode: 'shared';
}

export interface DatabaseConnection {
  sqlite: Database.Database;
  close(): void;
}

export interface DatabaseFixtureDependencies<Connection extends DatabaseConnection> {
  acquireDatabaseLock(input: { databasePath: string; mode: 'shared' }): DatabaseLock;
  releaseDatabaseLock(lock: DatabaseLock): void;
  openDatabase(input: { path: string; lock: DatabaseLock; now: () => number }): Connection;
  migrateDatabase(connection: Connection): void;
}

export interface DatabaseFixture<Connection extends DatabaseConnection = DatabaseConnection> {
  directory: string;
  path: string;
  connection: Connection;
  close(): Promise<void>;
}

/** Creates a real temporary file database and applies the production migration callback. */
export async function createDatabaseFixture<Connection extends DatabaseConnection>(
  dependencies: DatabaseFixtureDependencies<Connection>,
  clock: TestClock,
): Promise<DatabaseFixture<Connection>> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-test-'));
  const path = join(directory, 'application.sqlite');
  let lock: DatabaseLock | undefined;
  let connection: Connection | undefined;

  try {
    lock = dependencies.acquireDatabaseLock({ databasePath: path, mode: 'shared' });
    connection = dependencies.openDatabase({ path, lock, now: clock.now });
    dependencies.migrateDatabase(connection);
  } catch (error) {
    try {
      connection?.close();
    } finally {
      try {
        if (lock !== undefined) dependencies.releaseDatabaseLock(lock);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    throw error;
  }

  if (lock === undefined || connection === undefined) {
    try {
      if (lock !== undefined) dependencies.releaseDatabaseLock(lock);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    throw new Error('Database fixture initialization did not complete');
  }
  const openedConnection = connection;
  const acquiredLock = lock;
  let closed = false;
  return {
    directory,
    path,
    connection: openedConnection,
    async close() {
      if (closed) return;
      closed = true;
      try {
        openedConnection.close();
      } finally {
        try {
          dependencies.releaseDatabaseLock(acquiredLock);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    },
  };
}
