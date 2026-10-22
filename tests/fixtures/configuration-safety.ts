import { createServer } from 'node:net';
import { createApp } from '../../src/api/app.js';
import { startDataHelper, type DataHelper } from '../../src/api/helper-client.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createDatabaseFixture } from './database.js';
import { createTestClock } from './clock.js';

/** Private migrated DB/helper/server; browser faults never affect another story fixture. */
export async function configurationSafetyServer() {
  const fixture = await createDatabaseFixture(
    { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock },
    createTestClock(),
  );
  let helper: DataHelper | undefined;
  let app: ReturnType<typeof createApp> | undefined;
  try {
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', resolve);
    });
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('No configuration fixture port');
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
    const host = `127.0.0.1:${address.port}`;
    helper = await startDataHelper({ databasePath: fixture.path });
    app = createApp({ helper, host });
    await app.listen({ host: '127.0.0.1', port: address.port });
    const opened = app;
    return {
      fixture,
      origin: `http://${host}`,
      async close() {
        try {
          await opened.close();
        } finally {
          await fixture.close();
        }
      },
    };
  } catch (error) {
    try {
      if (app) await app.close();
      else await helper?.close();
    } finally {
      await fixture.close();
    }
    throw error;
  }
}
