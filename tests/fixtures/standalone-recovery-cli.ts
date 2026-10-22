import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { responseEnvelopeSchema, type MutationEnvelope } from '../../src/schema/envelopes.js';
import { getRecoveryStatus } from '../../src/core/recovery/status.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import type { RecoveryFixture } from './recovery.js';

const entry = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

/** The production CLI consumes a flat wire body, not a nested internal payload. */
export function standaloneBody(envelope: MutationEnvelope): string {
  const { payload, ...tokens } = envelope;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Standalone CLI fixture needs an object payload');
  return JSON.stringify({ ...tokens, ...payload });
}

/** Spawn the actual compiled entry without holding any inherited database descriptor. */
export async function standaloneRecoveryCli(
  fixture: RecoveryFixture,
  command: string[],
  input?: MutationEnvelope,
) {
  const child = spawn(
    process.execPath,
    [entry, ...command, '--json', ...(input ? ['--input', '-'] : [])],
    {
      env: {
        ...process.env,
        AI_TASKS_DB_PATH: fixture.databasePath,
        AI_TASKS_BACKUP_DIR: fixture.backupDirectory,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  try {
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      },
    );
    child.stdin.on('error', () => {});
    child.stdin.end(input ? standaloneBody(input) : undefined);
    const result = await closed;
    const text = result.code === 0 ? stdout : stderr;
    if (text.trimEnd().split('\n').length !== 1 || !text.endsWith('\n'))
      throw new Error(
        `Expected one structured CLI envelope: ${JSON.stringify({ ...result, stdout, stderr })}`,
      );
    const value: unknown = JSON.parse(text);
    return { ...result, stdout, stderr, envelope: responseEnvelopeSchema.parse(value) };
  } finally {
    clearTimeout(timer);
  }
}

export async function waitStandaloneRecovery(fixture: RecoveryFixture, jobId: string) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const result = await getRecoveryStatus({ backupDirectory: fixture.backupDirectory, jobId });
    if (result.data.state === 'failed' || result.data.state === 'succeeded') return result;
    await delay(20);
  }
  throw new Error('Standalone recovery owner did not publish a terminal receipt');
}

/** Successful takeover also proves no detached recovery owner retains its DB lock. */
export function proveRecoveryUnlocked(fixture: RecoveryFixture) {
  const lock = acquireDatabaseLock({
    databasePath: fixture.databasePath,
    mode: 'exclusive',
    timeoutSeconds: 2,
  });
  releaseDatabaseLock(lock);
}

/** Pure read commands must leave every managed file and its bytes untouched. */
export async function standaloneRecoveryInventory(fixture: RecoveryFixture) {
  const entries = await readdir(fixture.backupDirectory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  return Promise.all(
    files.map(async (path) => ({
      path: relative(fixture.backupDirectory, path),
      checksum: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    })),
  );
}
