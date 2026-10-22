import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  refuseUnresolvedRecovery,
  verifyConnectionLock,
  type ConnectionLock,
} from './lock-check.js';

export function verifySqliteVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('Unsupported SQLite version');
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  if (major > 3 || (major === 3 && (minor > 51 || (minor === 51 && patch >= 3)))) return;
  throw new Error('SQLite 3.51.3 or newer is required');
}

export function openDatabase(options: {
  path: string;
  lock: ConnectionLock;
  now?: () => number;
  busyTimeoutMs?: number;
}) {
  const path = verifyConnectionLock(options.path, options.lock);
  refuseUnresolvedRecovery(path);
  const busyTimeout = options.busyTimeoutMs ?? 5000;
  if (!Number.isInteger(busyTimeout) || busyTimeout < 0 || busyTimeout > 5000)
    throw new Error('Invalid database busy timeout');
  const sqlite = new Database(path, { timeout: busyTimeout });
  try {
    const version = sqlite.prepare('SELECT sqlite_version()').pluck().get();
    if (typeof version !== 'string') throw new Error('Could not identify SQLite version');
    verifySqliteVersion(version);
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma(`busy_timeout = ${busyTimeout}`);
    if (
      sqlite.pragma('foreign_keys', { simple: true }) !== 1 ||
      sqlite.pragma('journal_mode', { simple: true }) !== 'wal' ||
      sqlite.pragma('synchronous', { simple: true }) !== 1 ||
      sqlite.pragma('busy_timeout', { simple: true }) !== busyTimeout
    )
      throw new Error('Database connection settings could not be applied');
    return {
      sqlite,
      db: drizzle(sqlite),
      now: options.now ?? Date.now,
      close() {
        if (sqlite.open) sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
