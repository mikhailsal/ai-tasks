import { fork } from 'node:child_process';
import { statSync } from 'node:fs';
import * as z from 'zod/mini';
import { createContext, createReadContext } from '../core/context.js';
import { openDatabase } from '../core/database/open.js';
import type { DatabaseConnection } from '../core/database/types.js';
import { hint } from '../core/diagnostics/hints.js';
import { domainError } from '../core/errors.js';
import { errorEnvelopeSchema } from '../schema/envelopes.js';
import { metaEnvelopeSchema } from '../schema/meta.js';
import { slugSchema } from '../schema/values.js';
import { runLocked } from '../runtime/locked-entry.js';
export { createReadContext };
const DEFAULT_DATABASE_PATH = 'data/ai-tasks.sqlite';
/** Names how the location is chosen without echoing the configured path (FR-014). */
function missingDatabase() {
  const step = hint(
    'run_migration',
    'Set AI_TASKS_DB_PATH or use the default, then run npm run db:migrate',
    { command: 'npm run db:migrate' },
  );
  return domainError(
    'INTERNAL_ERROR',
    `Database not found. Set AI_TASKS_DB_PATH (default ${DEFAULT_DATABASE_PATH} in the working directory) and run npm run db:migrate`,
    {
      location: process.env.AI_TASKS_DB_PATH === undefined ? 'default' : 'AI_TASKS_DB_PATH',
      default_path: DEFAULT_DATABASE_PATH,
      hints: [step],
    },
  );
}
export function createCliMutationContext(connection: DatabaseConnection, projectSlug: string) {
  const slug = slugSchema.parse(projectSlug);
  return createContext({ connection, actor: `ai-cli:${slug}` });
}
export async function withCliDatabase<Output>(
  run: (connection: DatabaseConnection) => Output | Promise<Output>,
): Promise<Output> {
  const path = process.env.AI_TASKS_DB_PATH ?? DEFAULT_DATABASE_PATH;
  try {
    if (!statSync(path).isFile()) throw new Error('Invalid database file');
  } catch {
    throw missingDatabase();
  }
  return runLocked({ databasePath: path, mode: 'shared' }, async (lock) => {
    const connection = openDatabase({ path, lock });
    try {
      return await run(connection);
    } finally {
      connection.close();
    }
  });
}
const readySchema = z.strictObject({ type: z.literal('ready'), envelope: metaEnvelopeSchema });
const failureSchema = z.strictObject({ type: z.literal('error'), error: errorEnvelopeSchema });
/** The API supervisor owns its child helpers. This CLI process owns no SQLite handle. */
export async function serveApi(
  onReady: (envelope: z.infer<typeof metaEnvelopeSchema>) => void,
): Promise<void> {
  const child = fork(new URL('./api.js', import.meta.url), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  await new Promise<void>((resolve, reject) => {
    let ready = false;
    let requestedShutdown = false;
    let failure: Error | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const stop = (signal: NodeJS.Signals): void => {
      child.kill(signal);
      escalation ??= setTimeout(() => {
        child.kill('SIGKILL');
      }, 5000);
      escalation.unref();
    };
    const startup = setTimeout(() => {
      failure = domainError('INTERNAL_ERROR', 'API startup deadline exceeded');
      stop('SIGTERM');
    }, 15000);
    const forward = (signal: NodeJS.Signals): void => {
      requestedShutdown = true;
      stop(signal);
    };
    const interrupt = (): void => forward('SIGINT');
    const terminate = (): void => forward('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.on('message', (message: unknown) => {
      const failed = failureSchema.safeParse(message);
      if (failed.success) {
        const error = failed.data.error.error;
        failure = domainError('INTERNAL_ERROR', 'API process failed');
        // Rebuild known operational errors using fixed safe registry messages; never
        // copy unvalidated child diagnostics or private process output to the CLI.
        if (['MAINTENANCE', 'DB_CONFLICT', 'VALIDATION_ERROR'].includes(error.code)) {
          failure = Object.assign(new Error('API process failed'), { code: error.code });
        }
        stop('SIGTERM');
        return;
      }
      const parsed = readySchema.safeParse(message);
      if (parsed.success && !ready) {
        clearTimeout(startup);
        ready = true;
        onReady(parsed.data.envelope);
      }
    });
    child.once('error', () => {
      failure = domainError('INTERNAL_ERROR', 'API process could not start');
    });
    child.once('close', (code) => {
      clearTimeout(startup);
      if (escalation !== undefined) clearTimeout(escalation);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      if (failure) reject(failure);
      else if (!ready || (code !== 0 && !requestedShutdown))
        reject(domainError('INTERNAL_ERROR', 'API process stopped unexpectedly'));
      else resolve();
    });
  });
}
