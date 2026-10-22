import { createApp } from '../../src/api/app.js';
import { startDataHelper, type DataHelper } from '../../src/api/helper-client.js';
import { createOrdinaryFixture } from './ordinary-work.js';
import { availablePort } from './http-delivery.js';

export async function auditBrowserServer() {
  const fixture = await createOrdinaryFixture();
  let helper: DataHelper | undefined;
  let app: ReturnType<typeof createApp> | undefined;
  try {
    const port = await availablePort();
    const host = `127.0.0.1:${port}`;
    helper = await startDataHelper({ databasePath: fixture.path });
    app = createApp({ helper, host });
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
