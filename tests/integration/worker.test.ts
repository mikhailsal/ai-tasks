import { stat } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import {
  createWorkerDatabase,
  observeWorkerDatabase,
  compiledWorkerMeta,
  startCompiledWorker,
  workerDatabaseSnapshot,
  type WorkerDatabase,
} from '../fixtures/worker-process.js';
const databases: WorkerDatabase[] = [];
const processes: ReturnType<typeof startCompiledWorker>[] = [];
afterEach(async () => {
  await Promise.all(processes.splice(0).map((worker) => worker.stop()));
  await Promise.all(databases.splice(0).map((database) => database.close()));
});
async function database(options: Parameters<typeof createWorkerDatabase>[0] = {}) {
  const result = await createWorkerDatabase(options);
  databases.push(result);
  return result;
}
function worker(path: string, args?: string[]) {
  const result = startCompiledWorker(path, args);
  processes.push(result);
  return result;
}
function expectOperationalStderr(stderr: string) {
  const allowed = new Set([
    'Recurring work processed',
    'Recurring work changed; refreshing saved revisions',
    'Database is busy; the same recurring proposal will be retried',
  ]);
  const lines = stderr.trimEnd().split('\n').filter(Boolean);
  expect(
    lines.every((line) => allowed.has(line)),
    stderr,
  ).toBe(true);
}
function completedRows(path: string, id: string) {
  return observeWorkerDatabase(path, (sqlite) =>
    z
      .object({ total: z.number(), missed: z.number(), future: z.number(), actual: z.number() })
      .parse(
        sqlite
          .prepare(
            `SELECT count(*) AS total,
      sum(CASE WHEN state='missed' THEN 1 ELSE 0 END) AS missed,
      sum(CASE WHEN deadline>? THEN 1 ELSE 0 END) AS future,
      sum(CASE WHEN actual_completed_at IS NOT NULL THEN 1 ELSE 0 END) AS actual
      FROM occurrences WHERE task_id=?`,
          )
          .get(Date.now(), id),
      ),
  );
}
function otherProjectSnapshot(path: string) {
  return observeWorkerDatabase(path, (sqlite) =>
    [
      'tasks',
      'schedule_generations',
      'recurrence_state',
      'recurrence_intervals',
      'occurrences',
      'audit_records',
      'operation_receipts',
    ].map((table) =>
      sqlite.prepare(`SELECT * FROM ${table} WHERE project_slug='beta' ORDER BY rowid`).all(),
    ),
  );
}
it('compiled worker produces readiness after a real startup pass following a successful metadata control [worker behavioral RED]', async () => {
  const db = await database();
  const meta = compiledWorkerMeta(db.path);
  expect(meta.error).toBeUndefined();
  expect(meta.signal).toBeNull();
  expect(meta.status, meta.stderr).toBe(0);
  expect(JSON.parse(meta.stdout)).toMatchObject({ ok: true, data: { database_epoch: db.epoch } });
  const process = worker(db.path);
  const first = await process.first;
  expect(first.kind, `Expected worker readiness; stderr=${process.output().stderr}`).toBe('ready');
  if (first.kind !== 'ready') throw new Error('Expected validated readiness');
  expect(first.envelope.data).toMatchObject({ project_slug: 'alpha' });
  expect(first.envelope.meta.database_epoch).toBe(db.epoch);
  expect(completedRows(db.path, db.alphaId).missed).toBeGreaterThan(0);
  expect(process.output().stdout.trimEnd().split('\n')).toHaveLength(1);
  expectOperationalStderr(process.output().stderr);
});
it('startup continuation drains more than128 anchors promptly with scoped worker actor/origin and one stdout envelope', async () => {
  const db = await database({ daysOld: 150 });
  const otherProject = otherProjectSnapshot(db.path);
  const process = worker(db.path);
  expect((await process.first).kind, process.output().stderr).toBe('ready');
  await expect
    .poll(() => completedRows(db.path, db.alphaId), { timeout: 5000, interval: 25 })
    .toEqual({ total: 152, missed: 151, future: 1, actual: 0 });
  expect(otherProjectSnapshot(db.path)).toEqual(otherProject);
  const audits = observeWorkerDatabase(db.path, (sqlite) =>
    z
      .array(
        z.object({
          actor: z.string(),
          origin: z.string(),
          project_slug: z.string(),
          operation_id: z.uuid(),
        }),
      )
      .parse(
        sqlite
          .prepare("SELECT * FROM audit_records WHERE origin='recurrence-worker' ORDER BY rowid")
          .all(),
      ),
  );
  expect(audits.length).toBeGreaterThan(128);
  expect(audits.every((row) => row.actor === 'ai-cli:alpha' && row.project_slug === 'alpha')).toBe(
    true,
  );
  const ids = new Set(audits.map((row) => row.operation_id));
  expect(ids.size).toBeGreaterThan(1);
  const receipts = observeWorkerDatabase(db.path, (sqlite) =>
    z
      .array(z.object({ actor: z.string(), project_slug: z.string() }))
      .parse(sqlite.prepare("SELECT * FROM operation_receipts WHERE actor='ai-cli:alpha'").all()),
  );
  expect(receipts.length).toBe(ids.size);
  expect(receipts.every((row) => row.project_slug === 'alpha')).toBe(true);
  expect(process.output().stdout.trimEnd().split('\n')).toHaveLength(1);
  expectOperationalStderr(process.output().stderr);
});
it.each(['SIGTERM', 'ipc'] as const)(
  '%s drains the compiled worker and releases its sole lifetime lock without replacing the lockfile',
  async (mode) => {
    const db = await database();
    const process = worker(db.path);
    expect((await process.first).kind, process.output().stderr).toBe('ready');
    const before = await stat(`${db.path}.lock`);
    expect(() =>
      acquireDatabaseLock({ databasePath: db.path, mode: 'exclusive', timeoutSeconds: 0 }),
    ).toThrowError(expect.objectContaining({ code: 'DB_CONFLICT' }));
    expect(await process.stop(mode)).toEqual({ code: 0, signal: null });
    const exclusive = acquireDatabaseLock({
      databasePath: db.path,
      mode: 'exclusive',
      timeoutSeconds: 0,
    });
    releaseDatabaseLock(exclusive);
    const after = await stat(`${db.path}.lock`);
    expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino });
    expect(process.output().stdout.trimEnd().split('\n')).toHaveLength(1);
    expectOperationalStderr(process.output().stderr);
  },
);
it('archived project startup is ready but remains inactive and never processes another project', async () => {
  const db = await database({ archived: true });
  const before = workerDatabaseSnapshot(db.path);
  const process = worker(db.path);
  expect((await process.first).kind, process.output().stderr).toBe('ready');
  expect(workerDatabaseSnapshot(db.path)).toEqual(before);
  expect(await process.stop()).toEqual({ code: 0, signal: null });
  expect(workerDatabaseSnapshot(db.path)).toEqual(before);
});
it.each([
  { name: 'missing scope', args: ['worker', 'run', '--json'], code: 'VALIDATION_ERROR', exit: 2 },
  {
    name: 'aggregate scope',
    args: ['worker', 'run', '--all-projects', '--json'],
    code: 'VALIDATION_ERROR',
    exit: 2,
  },
  {
    name: 'mixed scope',
    args: ['worker', 'run', '--project', 'alpha', '--all-projects', '--json'],
    code: 'VALIDATION_ERROR',
    exit: 2,
  },
  {
    name: 'missing project',
    args: ['worker', 'run', '--project', 'absent', '--json'],
    code: 'PROJECT_NOT_FOUND',
    exit: 3,
  },
  {
    name: 'caller actor',
    args: ['worker', 'run', '--project', 'alpha', '--actor', 'human-web', '--json'],
    code: 'VALIDATION_ERROR',
    exit: 2,
  },
])(
  'worker rejects $name with a safe single stderr envelope and no readiness/state changes',
  async ({ args, code, exit }) => {
    const db = await database();
    const before = workerDatabaseSnapshot(db.path);
    const process = worker(db.path, args);
    expect((await process.first).kind).toBe('exit');
    expect(await process.closed).toEqual({ code: exit, signal: null });
    expect(process.output().stdout).toBe('');
    const lines = process.output().stderr.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(errorEnvelopeSchema.parse(JSON.parse(lines[0] ?? '')).error.code).toBe(code);
    expect(workerDatabaseSnapshot(db.path)).toEqual(before);
  },
);
