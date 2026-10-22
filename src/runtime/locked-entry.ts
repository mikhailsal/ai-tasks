import { acquireDatabaseLock, releaseDatabaseLock } from './database-lock.js';

/** The caller closes every connection in its callback before this lifetime ends.
 * Shared descriptors are never placed in subprocess stdio except flock's acquisition. */
export async function runLocked<Output>(
  options: { databasePath: string; mode: 'shared' | 'exclusive'; timeoutSeconds?: number },
  run: (lock: ReturnType<typeof acquireDatabaseLock>) => Output | Promise<Output>,
): Promise<Output> {
  const lock = acquireDatabaseLock(options);
  try {
    return await run(lock);
  } finally {
    releaseDatabaseLock(lock);
  }
}
