import { domainError, errorEnvelope } from '../core/errors.js';
import { superviseApi } from '../runtime/supervisor.js';

function configuration() {
  const port = Number(process.env.AI_TASKS_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw domainError('VALIDATION_ERROR', 'Invalid local API port');
  const origin = process.env.AI_TASKS_ORIGIN ?? `http://127.0.0.1:${port}`;
  const developmentOrigin =
    process.env.NODE_ENV === 'development' ? process.env.AI_TASKS_DEV_ORIGIN : undefined;
  return {
    port,
    security: {
      host: new URL(origin).host,
      origin,
      ...(developmentOrigin === undefined ? {} : { developmentOrigin }),
    },
  };
}

async function serve(): Promise<void> {
  const config = configuration();
  await superviseApi({
    databasePath: process.env.AI_TASKS_DB_PATH ?? './data/ai-tasks.sqlite',
    ...config,
    onReady(envelope) {
      if (process.connected) process.send?.({ type: 'ready', envelope });
      else process.stdout.write(`${JSON.stringify(envelope)}\n`);
    },
  });
  if (process.connected) process.disconnect();
}

try {
  await serve();
} catch (error) {
  const envelope = errorEnvelope(error);
  if (process.connected) {
    process.send?.({ type: 'error', error: envelope }, () => {
      if (process.connected) process.disconnect();
    });
  } else process.stderr.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = 1;
}
