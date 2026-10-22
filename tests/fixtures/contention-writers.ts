import type { ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { z } from 'zod/mini';
import { helperCommandSchema, type HelperCommand } from '../../src/api/helper-protocol.js';
import { responseEnvelopeSchema } from '../../src/schema/envelopes.js';
import { createProcessBarrier } from './process-barrier.js';
import type { OrdinaryFixture } from './ordinary-work.js';
const readySchema = z.object({
  type: z.literal('ready'),
  workerPid: z.number(),
  helperPid: z.number(),
});
const resultSchema = z.object({
  type: z.literal('result'),
  workerId: z.number(),
  workerPid: z.number(),
  helperPid: z.number(),
  elapsedMs: z.number(),
  envelope: responseEnvelopeSchema,
});
function messageFrom<Schema extends z.ZodMiniType>(
  child: ChildProcess,
  schema: Schema,
  timeoutMs: number,
): Promise<z.output<Schema>> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const onMessage = (message: unknown) => {
      if (z.object({ type: z.literal('failed') }).safeParse(message).success) {
        cleanup();
        reject(new Error(`Writer fixture failed: ${JSON.stringify(message)}`));
        return;
      }
      const parsed = schema.safeParse(message);
      if (parsed.success) {
        cleanup();
        resolve(parsed.data);
      }
    };
    const onExit = () => {
      cleanup();
      reject(new Error('Writer exited before its protocol event'));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Writer exceeded its protocol deadline'));
    }, timeoutMs);
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}
export async function createContentionWriters(fixture: OrdinaryFixture, commands: HelperCommand[]) {
  const requests = commands.map((command) => helperCommandSchema.parse(command));
  const barrier = createProcessBarrier(requests.length, {
    modulePath: fileURLToPath(new URL('./contention-writer.mjs', import.meta.url)),
    workerArgs: [fixture.path, JSON.stringify(requests)],
  });
  const readiness = Promise.all(
    barrier.workers.map(({ child }) => messageFrom(child, readySchema, 10000)),
  );
  try {
    await barrier.waitForReady(10000);
    const ready = await readiness;
    const results = Promise.all(
      barrier.workers.map(({ child }) => messageFrom(child, resultSchema, 15000)),
    );
    void results.catch(() => {});
    return {
      helpers: ready.map((item) => item.helperPid),
      workers: ready.map((item) => item.workerPid),
      release: () => barrier.release(),
      results,
      close: () => barrier.close(),
    };
  } catch (error) {
    await barrier.close();
    await readiness.catch(() => {});
    throw error;
  }
}
/** Observe the helper sleeping inside native SQLite's real busy handler, not a guessed delay. */
export async function waitForNativeBusy(helperPid: number) {
  const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    const channel = await readFile(`/proc/${helperPid}/wchan`, 'utf8');
    if (/nanosleep/u.test(channel)) return channel.trim();
    await pause(10);
  }
  throw new Error('Production writer did not enter the native SQLite busy wait');
}
