import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { lstatSync } from 'node:fs';
import { uuidSchema } from '../../schema/values.js';
import { verifyConnectionLock, type ConnectionLock } from '../database/lock-check.js';
import { verifySqliteVersion } from '../database/open.js';
import { domainError } from '../errors.js';

export function verifyRecoveryLock(databasePath: string, lock: ConnectionLock): string {
  if (lock.mode !== 'exclusive')
    throw domainError('INTERNAL_ERROR', 'Recovery requires an exclusive maintenance lock');
  return verifyConnectionLock(databasePath, lock);
}

/** The private stage is always beside the locked live file, on the same filesystem. */
export function recoveryStagePath(databasePath: string, jobId: string): string {
  return `${databasePath}.restore-${uuidSchema.parse(jobId)}.sqlite`;
}

type RecoveryConnectionOptions = {
  databasePath: string;
  lock: ConnectionLock;
  now: () => number;
} & ({ role: 'read-live' | 'write-live' } | { role: 'stage'; jobId: string });

function configureConnection(sqlite: Database.Database, role: RecoveryConnectionOptions['role']) {
  const version: unknown = sqlite.prepare('SELECT sqlite_version()').pluck().get();
  if (typeof version !== 'string') throw domainError('INTERNAL_ERROR', 'SQLite is unavailable');
  verifySqliteVersion(version);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  if (role === 'read-live') sqlite.pragma('query_only = ON');
  else {
    const journal = role === 'stage' ? 'delete' : 'wal';
    sqlite.pragma(`journal_mode = ${journal}`);
    sqlite.pragma('synchronous = NORMAL');
    if (
      sqlite.pragma('journal_mode', { simple: true }) !== journal ||
      sqlite.pragma('synchronous', { simple: true }) !== 1
    )
      throw domainError('INTERNAL_ERROR', 'Recovery connection settings could not be applied');
  }
  if (
    sqlite.pragma('foreign_keys', { simple: true }) !== 1 ||
    sqlite.pragma('busy_timeout', { simple: true }) !== 5000
  )
    throw domainError('INTERNAL_ERROR', 'Recovery connection settings could not be applied');
}

/** Private recovery access proves the actual live flock even when opening its derived stage.
 * Normal openDatabase continues to refuse unresolved publication manifests. */
export function openRecoveryConnection(options: RecoveryConnectionOptions) {
  const live = verifyRecoveryLock(options.databasePath, options.lock);
  const path = options.role === 'stage' ? recoveryStagePath(live, options.jobId) : live;
  const file = lstatSync(path);
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1)
    throw domainError('INTERNAL_ERROR', 'Recovery requires an independent regular database file');
  const sqlite = new Database(path, {
    readonly: options.role === 'read-live',
    fileMustExist: true,
    timeout: 5000,
  });
  try {
    configureConnection(sqlite, options.role);
    return {
      sqlite,
      db: drizzle(sqlite),
      now: options.now,
      close() {
        if (sqlite.open) sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
