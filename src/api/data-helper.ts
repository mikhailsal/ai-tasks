import * as z from 'zod/mini';
import { createContext } from '../core/context.js';
import { openDatabase } from '../core/database/open.js';
import { domainError, errorEnvelope } from '../core/errors.js';
import { readMeta } from '../core/queries/meta.js';
import { successEnvelopeSchema } from '../schema/envelopes.js';
import { uuidSchema } from '../schema/values.js';
import { runLocked } from '../runtime/locked-entry.js';
import { helperRequestSchema, type HelperRequest } from './helper-protocol.js';
import { dispatch } from './dispatch.js';
import { dispatchRecovery } from './recovery-dispatch.js';

function send(message: unknown): void {
  if (!process.connected) return;
  try {
    process.send?.(message, () => {});
  } catch {
    // A disconnected caller cannot cancel already accepted operational work.
  }
}

/** Tracks execution, rather than caller response timers, through the complete drain. */
export function createHelperDrain(options: {
  dispatch: (request: HelperRequest) => unknown;
  send: (message: unknown) => void;
}) {
  let accepting = true;
  const active = new Set<Promise<void>>();
  const drained = Promise.withResolvers<void>();
  const stop = () => {
    accepting = false;
    if (active.size === 0) drained.resolve();
    return drained.promise;
  };
  const respond = (message: unknown, error: unknown) => {
    const identity = z.object({ id: uuidSchema }).safeParse(message);
    if (identity.success)
      options.send({ type: 'response', id: identity.data.id, envelope: errorEnvelope(error) });
    else {
      options.send({ type: 'fatal', error: errorEnvelope(error) });
      void stop();
    }
  };
  const receive = (message: unknown) => {
    if (z.strictObject({ type: z.literal('shutdown') }).safeParse(message).success) {
      void stop();
      return;
    }
    try {
      if (!accepting) throw domainError('MAINTENANCE', 'API data helper is draining');
      const request = helperRequestSchema.parse(message);
      const work = Promise.resolve()
        .then(() => options.dispatch(request))
        .then((envelope) =>
          options.send({
            type: 'response',
            id: request.id,
            envelope: successEnvelopeSchema.parse(envelope),
          }),
        )
        .catch((error: unknown) => respond(message, error));
      active.add(work);
      void work.then(() => {
        active.delete(work);
        if (!accepting && active.size === 0) drained.resolve();
      });
    } catch (error) {
      respond(message, error);
    }
  };
  return { receive, stop, drained: drained.promise };
}

function attachDrain(drain: ReturnType<typeof createHelperDrain>) {
  const shutdown = () => void drain.stop();
  process.on('message', drain.receive);
  process.once('disconnect', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return () => {
    process.off('message', drain.receive);
    process.off('disconnect', shutdown);
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
  };
}

/** Only this child holds SQLite and the shared lifetime lock; the supervisor does neither. */
export async function runDataHelper(): Promise<void> {
  try {
    await runLocked(
      { databasePath: process.env.AI_TASKS_DB_PATH ?? './data/ai-tasks.sqlite', mode: 'shared' },
      async (lock) => {
        const connection = openDatabase({ path: lock.databasePath, lock });
        try {
          const context = createContext({ connection, actor: 'human-web' });
          readMeta(context, { all_projects: true });
          const directory = process.env.AI_TASKS_BACKUP_DIR;
          const drain = createHelperDrain({
            send,
            dispatch: (request) =>
              request.operation === 'backup.create' ||
              request.operation === 'backup.list' ||
              request.operation === 'backup.validate' ||
              request.operation === 'backup.restore.accept'
                ? dispatchRecovery(connection, request, {
                    ...(directory === undefined ? {} : { backupDirectory: directory }),
                  })
                : dispatch(context, request),
          });
          const detach = attachDrain(drain);
          try {
            send({ type: 'ready' });
            await drain.drained;
          } finally {
            detach();
          }
        } finally {
          connection.close();
        }
      },
    );
  } catch (error) {
    send({ type: 'fatal', error: errorEnvelope(error) });
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
}
