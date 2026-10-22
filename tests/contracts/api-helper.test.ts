import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { helperMessageSchema } from '../../src/api/helper-protocol.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createDatabaseFixture, type DatabaseFixture } from '../fixtures/database.js';
import { createTestClock } from '../fixtures/clock.js';

let fixture: DatabaseFixture;
beforeAll(async () => {
  fixture = await createDatabaseFixture(
    { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock },
    createTestClock(),
  );
});
afterAll(async () => fixture?.close());

it('the compiled helper rejects unsupported operations and caller actors, then drains its real connection/lock', async () => {
  const child = fork(fileURLToPath(new URL('../../dist/data-helper.js', import.meta.url)), [], {
    env: { ...process.env, AI_TASKS_DB_PATH: fixture.path },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  try {
    const [ready] = await once(child, 'message');
    expect(helperMessageSchema.parse(ready)).toEqual({ type: 'ready' });
    for (const command of [
      { operation: 'unsupported', scope: { all_projects: true } },
      { operation: 'meta', scope: { all_projects: true }, actor: 'ai-cli:alpha' },
    ]) {
      const id = randomUUID();
      const result = once(child, 'message');
      child.send({ type: 'request', id, ...command });
      const [message] = await result;
      expect(helperMessageSchema.parse(message)).toMatchObject({
        type: 'response',
        id,
        envelope: { ok: false, error: { code: 'VALIDATION_ERROR' } },
      });
    }
    const exit = once(child, 'exit');
    child.send({ type: 'shutdown' });
    expect(await exit).toEqual([0, null]);
    expect(
      fixture.connection.sqlite.prepare('SELECT count(*) AS count FROM audit_records').get(),
    ).toEqual({ count: 0 });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
    }
  }
});
