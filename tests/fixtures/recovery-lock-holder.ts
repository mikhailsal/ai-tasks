import type { ChildProcess, Serializable } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/mini';
import { createProcessBarrier } from './process-barrier.js';

const worker = fileURLToPath(new URL('./lock-worker.mjs', import.meta.url));
const eventSchema = z.object({ type: z.string(), code: z.optional(z.string()) });

function command(child: ChildProcess, message: Serializable, expected: string) {
  return new Promise<void>((resolve, reject) => {
    function finish(error?: Error) {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    }
    function onMessage(value: unknown) {
      const parsed = eventSchema.safeParse(value);
      if (!parsed.success) return;
      if (parsed.data.type === expected) finish();
      else if (parsed.data.type === 'failed')
        finish(new Error(`Lock holder failed: ${parsed.data.code}`));
    }
    function onError(error: Error) {
      finish(error);
    }
    function onExit() {
      finish(new Error('Lock holder exited before acknowledgement'));
    }
    const timer = setTimeout(
      () => finish(new Error('Lock holder acknowledgement timed out')),
      4000,
    );
    child.on('message', onMessage);
    child.once('error', onError);
    child.once('exit', onExit);
    child.send(message);
  });
}

export async function startSharedHolders(databasePath: string, count: number) {
  const barrier = createProcessBarrier(count, { modulePath: worker });
  try {
    await barrier.waitForReady(4000);
    await Promise.all(
      barrier.workers.map(({ child }) =>
        command(
          child,
          {
            type: 'acquire',
            databasePath,
            mode: 'shared',
            timeoutSeconds: 0,
          },
          'acquired',
        ),
      ),
    );
  } catch (error) {
    await barrier.close();
    throw error;
  }
  return {
    async release(index: number) {
      const holder = barrier.workers[index];
      if (!holder) throw new Error('Unknown shared holder');
      await command(holder.child, { type: 'release' }, 'released');
    },
    close: () => barrier.close(),
  };
}
