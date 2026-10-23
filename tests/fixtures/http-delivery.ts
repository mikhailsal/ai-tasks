import { availablePort } from './available-port.js';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createApp } from '../../src/api/app.js';
import { startDataHelper, type DataHelper } from '../../src/api/helper-client.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createDatabaseFixture } from './database.js';
import { createTestClock } from './clock.js';

export { availablePort } from './available-port.js';

export async function deliveryServer(
  options: { developmentOrigin?: string; excludePort?: number } = {},
) {
  const fixture = await createDatabaseFixture(
    { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock },
    createTestClock(),
  );
  let helper: DataHelper | undefined;
  let app: ReturnType<typeof createApp> | undefined;
  try {
    const port = await availablePort(options.excludePort);
    const host = `127.0.0.1:${port}`;
    helper = await startDataHelper({ databasePath: fixture.path });
    app = createApp({
      helper,
      host,
      ...(options.developmentOrigin ? { developmentOrigin: options.developmentOrigin } : {}),
    });
    await app.listen({ host: '127.0.0.1', port });
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

/** Loads the real Vite config/plugins, changing only isolated loopback test ports. */
export async function developmentDelivery() {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const backend = await deliveryServer({ developmentOrigin: origin, excludePort: port });
  const vite = await createViteServer({
    configFile: fileURLToPath(new URL('../../web/vite.config.ts', import.meta.url)),
    logLevel: 'silent',
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      hmr: false,
      proxy: { '/api': { target: backend.origin, changeOrigin: true } },
    },
  });
  try {
    await vite.listen();
    return {
      origin,
      backend,
      async close() {
        try {
          await vite.close();
        } finally {
          await backend.close();
        }
      },
    };
  } catch (error) {
    try {
      await vite.close();
    } finally {
      await backend.close();
    }
    throw error;
  }
}
