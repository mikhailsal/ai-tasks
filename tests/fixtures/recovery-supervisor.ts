import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { availablePort } from './available-port.js';

export async function startRecoverySupervisor(input: {
  databasePath: string;
  backupDirectory: string;
}) {
  const origin = `http://127.0.0.1:${await availablePort()}`;
  const child = fork(fileURLToPath(new URL('../../dist/api.js', import.meta.url)), [], {
    env: {
      ...process.env,
      AI_TASKS_DB_PATH: input.databasePath,
      AI_TASKS_BACKUP_DIR: input.backupDirectory,
      AI_TASKS_PORT: new URL(origin).port,
      AI_TASKS_ORIGIN: origin,
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    execArgv: [],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.length < 65536) stderr += chunk.toString('utf8');
  });
  const exit = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const ready = new Promise<ReturnType<typeof metaEnvelopeSchema.parse>>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Recovery supervisor readiness expired: ${stderr}`)),
      8000,
    );
    const fail = () => {
      clearTimeout(timer);
      reject(new Error(`Recovery supervisor exited before readiness: ${stderr}`));
    };
    child.once('error', fail);
    child.once('exit', fail);
    child.on('message', (message: unknown) => {
      if (message === null || typeof message !== 'object' || !('envelope' in message)) return;
      const parsed = metaEnvelopeSchema.safeParse(message.envelope);
      if (parsed.success) {
        clearTimeout(timer);
        resolve(parsed.data);
      }
    });
  });
  return {
    origin,
    ready,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return exit;
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.kill('SIGTERM');
      try {
        await exit;
      } finally {
        clearTimeout(kill);
      }
    },
  };
}
