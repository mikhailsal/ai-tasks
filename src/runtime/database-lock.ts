import { spawnSync } from 'node:child_process';
import {
  constants,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export class DatabaseLockError extends Error {
  readonly code: 'DB_CONFLICT' | 'INTERNAL_ERROR' | 'VALIDATION_ERROR';
  readonly retryable: boolean;

  constructor(code: DatabaseLockError['code'], message: string) {
    super(message);
    this.name = 'DatabaseLockError';
    this.code = code;
    this.retryable = code === 'DB_CONFLICT';
  }
}

const releasedLocks = new WeakSet<object>();
const acquiredLocks = new WeakSet<object>();

export function canonicalDatabasePath(databasePath: string): string {
  if (databasePath.length === 0 || databasePath === ':memory:') {
    throw new DatabaseLockError('VALIDATION_ERROR', 'A local database file is required');
  }
  const requestedPath = resolve(databasePath);
  mkdirSync(dirname(requestedPath), { recursive: true, mode: 0o700 });
  const path = join(realpathSync(dirname(requestedPath)), basename(requestedPath));
  try {
    const file = lstatSync(path);
    if (!file.isFile() || file.nlink !== 1) {
      throw new DatabaseLockError(
        'VALIDATION_ERROR',
        'A database must be one regular file without aliases',
      );
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return path;
}

/** flock on an explicitly inherited descriptor locks its shared open-file-description.
 * The parent keeps that description open after the short flock child exits. */
export function acquireDatabaseLock<Mode extends 'shared' | 'exclusive'>(options: {
  databasePath: string;
  mode: Mode;
  timeoutSeconds?: number;
}): { databasePath: string; lockPath: string; fd: number; mode: Mode } {
  const timeoutSeconds = options.timeoutSeconds ?? 5;
  if (
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds < 0 ||
    (options.mode !== 'shared' && options.mode !== 'exclusive')
  ) {
    throw new DatabaseLockError('VALIDATION_ERROR', 'Invalid maintenance lock options');
  }
  const databasePath = canonicalDatabasePath(options.databasePath);
  const lockPath = `${databasePath}.lock`;
  const fd = openSync(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    if (!fstatSync(fd).isFile())
      throw new DatabaseLockError('INTERNAL_ERROR', 'Invalid maintenance lock file');
    const result = spawnSync(
      'flock',
      [
        options.mode === 'shared' ? '--shared' : '--exclusive',
        '--conflict-exit-code',
        '75',
        '--timeout',
        String(timeoutSeconds),
        '3',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe', fd],
        timeout: Math.ceil(timeoutSeconds * 1_000) + 2_000,
        killSignal: 'SIGKILL',
        env: { ...process.env, LC_ALL: 'C' },
      },
    );
    if (result.status === 75)
      throw new DatabaseLockError('DB_CONFLICT', 'Database maintenance lock wait exhausted');
    if (result.error || result.status !== 0)
      throw new DatabaseLockError(
        'INTERNAL_ERROR',
        'Could not acquire the database maintenance lock',
      );
    const lock = Object.freeze({ databasePath, lockPath, fd, mode: options.mode });
    acquiredLocks.add(lock);
    return lock;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function releaseDatabaseLock(lock: { fd: number }): void {
  if (releasedLocks.has(lock)) return;
  if (!acquiredLocks.has(lock))
    throw new DatabaseLockError('INTERNAL_ERROR', 'Unrecognized maintenance lock');
  releasedLocks.add(lock);
  closeSync(lock.fd);
}
