import { fork } from 'node:child_process';
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'tsup';
import { z } from 'zod/mini';
import { jsonValueSchema } from '../../src/schema/values.js';
import type { MutationEnvelope } from '../../src/schema/envelopes.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const eventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({ type: z.literal('attempting'), descriptors: z.array(z.string()) }),
  z.strictObject({ type: z.literal('locked') }),
  z.strictObject({ type: z.literal('barrier'), name: z.string() }),
  z.strictObject({ type: z.literal('result'), value: jsonValueSchema }),
  z.strictObject({ type: z.literal('error'), value: jsonValueSchema }),
]);
type Event = z.output<typeof eventSchema>;
type Request = {
  action: 'restore' | 'recover';
  databasePath: string;
  backupDirectory: string;
  projectSlug?: string;
  envelope?: MutationEnvelope;
  actor?: string;
  now: number;
  pauseAt?: string;
  lockTimeoutSeconds?: number;
};

/** Compile the actual core/runtime into an isolated test artifact, never server dist/. */
export async function buildRecoveryDriver() {
  const artifacts = join(root, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(join(artifacts, 'recovery-driver-'));
  const output = join(directory, 'dist');
  try {
    // Mirror the production dist/ + drizzle/ layout, including actual migration assets.
    await cp(join(root, 'drizzle'), join(directory, 'drizzle'), { recursive: true });
    await build({
      entry: { 'recovery-driver': join(root, 'tests/fixtures/recovery-driver.mjs') },
      config: false,
      outDir: output,
      format: ['esm'],
      platform: 'node',
      target: 'node24',
      external: ['better-sqlite3'],
      noExternal: [/^drizzle-orm(?:\/|$)/u, /^zod(?:\/|$)/u],
      splitting: true,
      sourcemap: false,
      shims: true,
      silent: true,
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    entry: join(output, 'recovery-driver.js'),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

export function startRecoveryDriver(entry: string) {
  const child = fork(entry, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] });
  const events: Event[] = [];
  const listeners = new Set<() => void>();
  let stderr = '';
  let exited = false;
  let transportError: Error | undefined;
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once('close', (code, signal) => {
        exited = true;
        resolve({ code, signal });
        for (const listener of listeners) listener();
      });
    },
  );
  child.once('error', (error) => {
    transportError = error;
    for (const listener of listeners) listener();
  });
  child.on('message', (message: unknown) => {
    const parsed = eventSchema.safeParse(message);
    if (parsed.success) events.push(parsed.data);
    else transportError = new Error('Recovery driver sent an invalid event');
    for (const listener of listeners) listener();
  });

  function waitFor(type: Event['type'], timeoutMs = 4000) {
    return new Promise<Event>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error(`Recovery event ${type} timed out`)),
        timeoutMs,
      );
      function finish(error?: Error) {
        clearTimeout(timer);
        listeners.delete(check);
        if (error) reject(error);
      }
      function check() {
        const index = events.findIndex((event) => event.type === type);
        if (index >= 0) {
          const event = events.splice(index, 1)[0];
          if (event?.type === type) {
            finish();
            resolve(event);
          }
        } else if (events.some((event) => event.type === 'error')) {
          const failure = events.find((event) => event.type === 'error');
          finish(
            new Error(
              `Recovery driver returned an error before ${type}: ${JSON.stringify(failure)}`,
            ),
          );
        } else if (transportError || exited) {
          finish(transportError ?? new Error(`Recovery driver exited before ${type}`));
        }
      }
      listeners.add(check);
      check();
    });
  }
  return {
    child,
    waitFor,
    completed,
    stderr: () => stderr,
    hasEvent: (type: Event['type']) => events.some((event) => event.type === type),
    run(request: Request) {
      child.send({ type: 'run', ...request });
    },
    release() {
      child.send({ type: 'release' });
    },
    kill() {
      child.kill('SIGKILL');
    },
    async close() {
      if (exited) return;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
      try {
        await completed;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
