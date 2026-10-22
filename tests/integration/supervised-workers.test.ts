import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';
import { errorDefinitions } from '../../src/schema/errors.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';
import {
  occurrenceRows,
  outcomeSnapshot,
  seedOccurrence,
  seedOutcomeParent,
} from '../fixtures/occurrence-outcomes.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';
import { boundedResult, supervisedServe } from '../fixtures/supervised-serve.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { openDatabase } from '../../src/core/database/open.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { ordinaryInput } from '../fixtures/ordinary-work.js';

let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

async function serverCopy() {
  const directory = await mkdtemp(join(tmpdir(), 'supervised-workers-'));
  const path = join(directory, 'database.sqlite');
  await fixture.connection.sqlite.backup(path);
  return { path, close: () => rm(directory, { recursive: true, force: true }) };
}
function assertExclusiveAvailable(path: string) {
  const lock = acquireDatabaseLock({ databasePath: path, mode: 'exclusive', timeoutSeconds: 0 });
  releaseDatabaseLock(lock);
}
function copiedSnapshot(path: string, tables: string[]) {
  const lock = acquireDatabaseLock({ databasePath: path, mode: 'shared', timeoutSeconds: 0 });
  try {
    const connection = openDatabase({ path, lock });
    try {
      return Object.fromEntries(
        tables.map((table) => [
          table,
          connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ]),
      );
    } finally {
      connection.close();
    }
  } finally {
    releaseDatabaseLock(lock);
  }
}

it('compiled serve starts a scoped worker before readiness and processes captured expiry with worker attribution', async () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() - 1000,
  });
  const occurrence = seedOccurrence(fixture, parent);
  expect(Date.now()).toBeGreaterThan(occurrence.expires_at);
  const server = await supervisedServe(fixture.path);
  try {
    await server.ready;
    expect(occurrenceRows(fixture, parent.id)).toMatchObject([
      { id: occurrence.id, state: 'debt', missed_at: occurrence.expires_at },
    ]);
    const audit = fixture.connection.sqlite
      .prepare(
        "SELECT actor,origin FROM audit_records WHERE action='occurrence.miss' AND entity_id=?",
      )
      .get(occurrence.id);
    expect(audit).toEqual({ actor: 'ai-cli:alpha', origin: 'recurrence-worker' });
    expect(server.output().stdout.trimEnd().split('\n')).toHaveLength(1);
  } finally {
    await server.close();
  }
});

it('ordinary-only supervised workers add no audit, receipt or domain state changes and drain on SIGTERM', async () => {
  createTask(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, {
      kind: 'ordinary',
      title: 'Обычная работа',
      description: 'Точный исходник  ',
    }),
  );
  const before = outcomeSnapshot(fixture);
  const copy = await serverCopy();
  const server = await supervisedServe(copy.path);
  try {
    await server.ready;
    expect(server.workers()).toHaveLength(1);
    const inode = (await stat(`${copy.path}.lock`)).ino;
    expect(() => assertExclusiveAvailable(copy.path)).toThrow(
      expect.objectContaining({ code: 'DB_CONFLICT' }),
    );
    expect(copiedSnapshot(copy.path, Object.keys(before))).toEqual(before);
    server.stop();
    expect(await boundedResult(server.completed, 2500)).toEqual({ code: 0, signal: null });
    expect(server.output().stderr).toBe('');
    expect(server.workers()).toHaveLength(0);
    expect(() => assertExclusiveAvailable(copy.path)).not.toThrow();
    expect((await stat(`${copy.path}.lock`)).ino).toBe(inode);
    expect(copiedSnapshot(copy.path, Object.keys(before))).toEqual(before);
  } finally {
    await server.close();
    await copy.close();
  }
});

it('unexpected owned worker death makes compiled serve fail safely without a second readiness line', async () => {
  const copy = await serverCopy();
  const server = await supervisedServe(copy.path);
  try {
    await server.ready;
    expect(server.workers()).toHaveLength(1);
    server.killWorker();
    expect(await boundedResult(server.completed, 2500)).toEqual({
      code: errorDefinitions.MAINTENANCE.cliExit,
      signal: null,
    });
    expect(server.output().stdout.trimEnd().split('\n')).toHaveLength(1);
    const failure = errorEnvelopeSchema.parse(JSON.parse(server.output().stderr));
    expect(failure.ok).toBe(false);
    expect(failure.error.code).toBe('MAINTENANCE');
    expect(server.output().stderr).not.toContain(fixture.directory);
    expect(server.workers()).toHaveLength(0);
    expect(() => assertExclusiveAvailable(copy.path)).not.toThrow();
  } finally {
    await server.close();
    await copy.close();
  }
});
