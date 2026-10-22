import { linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';

it('rejects hard-linked database aliases that would create independent maintenance locks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-tasks-lock-alias-'));
  let acquired: ReturnType<typeof acquireDatabaseLock> | undefined;
  try {
    const databasePath = join(directory, 'original.sqlite');
    writeFileSync(databasePath, '');
    linkSync(databasePath, join(directory, 'alias.sqlite'));
    expect(() => {
      acquired = acquireDatabaseLock({ databasePath, mode: 'shared', timeoutSeconds: 0 });
    }).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  } finally {
    if (acquired) releaseDatabaseLock(acquired);
    rmSync(directory, { recursive: true, force: true });
  }
});
