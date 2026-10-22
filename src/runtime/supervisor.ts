import { dirname, join, resolve } from 'node:path';
import { createApp } from '../api/app.js';
import type { DataHelper } from '../api/helper-client.js';
import { canonicalDatabasePath } from './database-lock.js';
import { createRecoveryController } from './recovery-controller.js';
import { startSupervisorControl } from './supervisor-control.js';
import { retryStartup } from './startup-retry.js';

type SupervisorOptions = {
  databasePath: string;
  port: number;
  security: Omit<Parameters<typeof createApp>[0], 'helper' | 'recovery'>;
  onReady: (envelope: Awaited<ReturnType<DataHelper['request']>>) => void;
};

/** Owns HTTP/control lifetimes without owning SQLite connections or database locks. */
export async function superviseApi(options: SupervisorOptions): Promise<void> {
  let failure: Error | undefined;
  let stopping = false;
  const stopped = Promise.withResolvers<void>();
  const lifetime = new AbortController();
  const shutdown = () => {
    stopping = true;
    lifetime.abort();
    stopped.resolve();
  };
  const unexpectedFailure = (error: Error) => {
    failure ??= error;
    shutdown();
  };
  const databasePath = canonicalDatabasePath(options.databasePath);
  const controller = createRecoveryController({
    databasePath,
    backupDirectory: resolve(
      process.env.AI_TASKS_BACKUP_DIR ?? join(dirname(databasePath), 'backups'),
    ),
    onFailure: unexpectedFailure,
  });
  const app = createApp({
    helper: controller.helper,
    recovery: controller.services,
    ...options.security,
  });
  let control: Awaited<ReturnType<typeof startSupervisorControl>> | undefined;
  const bootstrap = async () => {
    const ready = await retryStartup({ signal: lifetime.signal, start: controller.initialize });
    if (!ready) return;
    const envelope = await controller.helper.request({
      operation: 'meta',
      scope: { all_projects: true },
    });
    if (!stopping) options.onReady(envelope);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('disconnect', shutdown);
  try {
    control = await startSupervisorControl({
      databasePath,
      submitRestore: (input) => controller.services.restore({ ...input, caller: 'cli' }),
    });
    if (!stopping) await app.listen({ host: '127.0.0.1', port: options.port });
    if (!stopping) await bootstrap();
    await stopped.promise;
    if (failure) throw failure;
  } finally {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    process.off('disconnect', shutdown);
    try {
      await controller.close();
    } finally {
      try {
        await app.close();
      } finally {
        await control?.close();
      }
    }
  }
}
