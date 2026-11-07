import { networkInterfaces } from 'node:os';
import { errorEnvelope } from '../core/errors.js';
import { resolveListenAddress } from '../runtime/listen-address.js';
import { superviseApi } from '../runtime/supervisor.js';

function configuration() {
  const { host, port, origin } = resolveListenAddress(process.env, networkInterfaces());
  const developmentOrigin =
    process.env.NODE_ENV === 'development' ? process.env.AI_TASKS_DEV_ORIGIN : undefined;
  return {
    host,
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
