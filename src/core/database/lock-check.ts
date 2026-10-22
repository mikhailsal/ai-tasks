import { fstatSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export type ConnectionLock = {
  databasePath: string;
  lockPath: string;
  fd: number;
  mode: 'shared' | 'exclusive';
};

/** Linux fdinfo verifies the actual open-file-description's flock, not caller claims. */
function verifyLockDescriptor(lock: ConnectionLock): void {
  const descriptor = fstatSync(lock.fd);
  const lockFile = lstatSync(lock.lockPath);
  if (
    !descriptor.isFile() ||
    !lockFile.isFile() ||
    descriptor.dev !== lockFile.dev ||
    descriptor.ino !== lockFile.ino
  )
    throw new Error();
  const fdinfo = readFileSync(`/proc/self/fdinfo/${lock.fd}`, 'utf8');
  const mode = lock.mode === 'shared' ? 'READ' : lock.mode === 'exclusive' ? 'WRITE' : '';
  if (!mode || !new RegExp(`^lock:\\s+\\d+: FLOCK\\s+ADVISORY\\s+${mode}\\s`, 'mu').test(fdinfo))
    throw new Error();
}

function verifyDatabaseFile(path: string): void {
  try {
    const database = lstatSync(path);
    if (!database.isFile() || database.nlink !== 1) throw new Error();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

export function verifyConnectionLock(path: string, lock: ConnectionLock): string {
  try {
    if (path === ':memory:' || path.length === 0) throw new Error();
    const requested = resolve(path);
    const canonical = join(realpathSync(dirname(requested)), basename(requested));
    if (lock.databasePath !== canonical || lock.lockPath !== `${canonical}.lock`) throw new Error();
    verifyLockDescriptor(lock);
    verifyDatabaseFile(canonical);
    return canonical;
  } catch {
    throw Object.assign(new Error('A held database maintenance lock is required'), {
      code: 'INTERNAL_ERROR',
    });
  }
}

// Recovery publication must clear this external phase manifest before normal opens.
export const RECOVERY_MANIFEST_SUFFIX = '.recovery.json';

export function refuseUnresolvedRecovery(databasePath: string): void {
  try {
    lstatSync(`${databasePath}${RECOVERY_MANIFEST_SUFFIX}`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw Object.assign(new Error('Database recovery status is unavailable'), {
      code: 'MAINTENANCE',
    });
  }
  throw Object.assign(new Error('Database recovery must finish before opening'), {
    code: 'MAINTENANCE',
  });
}
