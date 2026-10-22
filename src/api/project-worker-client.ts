import * as z from 'zod/mini';
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { domainError } from '../core/errors.js';
import { metaDataSchema } from '../schema/meta.js';
import { successEnvelopeSchema } from '../schema/envelopes.js';
import { slugSchema } from '../schema/values.js';

const readinessSchema = z.extend(successEnvelopeSchema, {
  data: z.extend(metaDataSchema, { project_slug: slugSchema }),
});
function workerEntry(): string {
  const entries = [
    new URL('./cli.js', import.meta.url),
    new URL('../../dist/cli.js', import.meta.url),
  ];
  const entry = entries.find((url) => existsSync(url));
  if (!entry) throw domainError('INTERNAL_ERROR', 'Compiled recurring worker is unavailable');
  return fileURLToPath(entry);
}
function stopChild(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    else child.kill('SIGTERM');
  });
}

/** Validates child readiness and suppresses private progress output at the API boundary. */
export async function startProjectWorker(options: {
  databasePath: string;
  projectSlug: string;
  onUnexpectedFailure: (error: Error) => void;
  signal?: AbortSignal;
}) {
  if (options.signal?.aborted)
    throw domainError('MAINTENANCE', 'Recurring worker startup cancelled');
  const projectSlug = slugSchema.parse(options.projectSlug);
  const child = fork(workerEntry(), ['worker', 'run', '--project', projectSlug, '--json'], {
    env: { ...process.env, AI_TASKS_DB_PATH: options.databasePath },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let closing: Promise<void> | undefined;
  let started = false;
  let notified = false;
  let output = '';
  let readySeen = false;
  const unavailable = () => domainError('MAINTENANCE', 'Recurring worker is unavailable');
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail(), 10000);
      const fail = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        reject(unavailable());
        if (started && !closing && !notified) {
          notified = true;
          options.onUnexpectedFailure(unavailable());
        }
      };
      const abort = () => {
        closing ??= stopChild(child);
        fail();
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      child.once('error', fail);
      child.once('exit', fail);
      child.once('disconnect', fail);
      child.stderr?.resume();
      child.stdout?.on('data', (chunk: Buffer) => {
        if (readySeen || output.length + chunk.length > 65536) {
          fail();
          child.kill('SIGTERM');
          return;
        }
        output += chunk.toString('utf8');
        if (!output.includes('\n')) return;
        try {
          if (!output.endsWith('\n') || output.trimEnd().split('\n').length !== 1)
            throw unavailable();
          const ready = readinessSchema.parse(JSON.parse(output));
          if (ready.data.project_slug !== projectSlug) throw unavailable();
          readySeen = true;
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', abort);
          resolve();
        } catch {
          fail();
          child.kill('SIGTERM');
        }
      });
    });
  } catch (error) {
    await (closing ?? stopChild(child));
    throw error;
  }
  started = true;
  return {
    close(): Promise<void> {
      closing ??= stopChild(child);
      return closing;
    },
  };
}
