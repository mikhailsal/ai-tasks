// Private test process: publication barriers are callbacks, never public CLI/API flags.
import { readdirSync, readlinkSync } from 'node:fs';
import { z } from 'zod/mini';
import { runLocked } from '../../src/runtime/locked-entry.js';
import { runRestore, recoverDatabase } from '../../src/core/recovery/index.ts';
import { errorEnvelope } from '../../src/core/errors.js';
import { mutationEnvelopeSchema } from '../../src/schema/envelopes.js';

const requestSchema = z.strictObject({
  type: z.literal('run'),
  action: z.enum(['restore', 'recover']),
  databasePath: z.string(),
  backupDirectory: z.string(),
  projectSlug: z.optional(z.string()),
  envelope: z.optional(mutationEnvelopeSchema),
  actor: z.optional(z.string()),
  now: z.int(),
  pauseAt: z.optional(z.string()),
  lockTimeoutSeconds: z.optional(z.number()),
});
let running = false;
let release;

function send(value) {
  return new Promise((resolve, reject) => {
    if (!process.connected) return reject(new Error('Test parent disconnected'));
    process.send(value, (error) => (error ? reject(error) : resolve()));
  });
}

function inheritedLocks(databasePath) {
  return readdirSync('/proc/self/fd').flatMap((fd) => {
    try {
      return readlinkSync(`/proc/self/fd/${fd}`) === `${databasePath}.lock` ? [fd] : [];
    } catch {
      return [];
    }
  });
}

async function run(request) {
  await send({ type: 'attempting', descriptors: inheritedLocks(request.databasePath) });
  return runLocked(
    {
      databasePath: request.databasePath,
      mode: 'exclusive',
      timeoutSeconds: request.lockTimeoutSeconds ?? 2,
    },
    async (lock) => {
      await send({ type: 'locked' });
      const failpoint = async (name) => {
        if (name !== request.pauseAt) return;
        const continued = new Promise((resolve) => {
          release = resolve;
        });
        await send({ type: 'barrier', name });
        await continued;
      };
      const common = {
        databasePath: request.databasePath,
        backupDirectory: request.backupDirectory,
        lock,
        now: () => request.now,
        failpoint,
      };
      if (request.action === 'recover') return recoverDatabase(common);
      if (!request.projectSlug || !request.envelope || !request.actor)
        throw new Error('Private restore request is incomplete');
      return runRestore({
        ...common,
        projectSlug: request.projectSlug,
        envelope: request.envelope,
        actor: request.actor,
      });
    },
  );
}

process.on('message', async (message) => {
  if (typeof message === 'object' && message !== null && message.type === 'release') {
    release?.();
    return;
  }
  if (running) return;
  running = true;
  try {
    const result = await run(requestSchema.parse(message));
    await send({ type: 'result', value: result ?? null });
  } catch (error) {
    await send({ type: 'error', value: errorEnvelope(error) });
  } finally {
    if (process.connected) process.disconnect();
  }
});
process.on('disconnect', () => process.exit(0));
await send({ type: 'ready' });
