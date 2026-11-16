import { afterEach, expect, it } from 'vitest';
import { workerStatus, WORKER_TOLERANCE_MS } from '../../src/core/worker/status.js';
import {
  compiledWorkerMeta,
  createWorkerDatabase,
  observeWorkerDatabase,
  startCompiledWorker,
  type WorkerDatabase,
} from '../fixtures/worker-process.js';

/** Spec 011 US1: never → healthy → stale → healthy with the compiled worker. */
const databases: WorkerDatabase[] = [];
const processes: ReturnType<typeof startCompiledWorker>[] = [];
afterEach(async () => {
  await Promise.all(processes.splice(0).map((worker) => worker.stop()));
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

type MetaWorker = { project_slug: string; status: string; last_pass_at?: string };
function metaWorkers(path: string): MetaWorker[] {
  const result = compiledWorkerMeta(path);
  expect(result.status, result.stderr).toBe(0);
  const parsed: unknown = JSON.parse(result.stdout);
  return (parsed as { data: { workers: MetaWorker[] } }).data.workers;
}
const lastPass = (path: string) =>
  observeWorkerDatabase(path, (sqlite) =>
    sqlite
      .prepare("SELECT last_pass_at FROM worker_passes WHERE project_slug='alpha'")
      .pluck()
      .get(),
  );

it('a stopped worker turns stale after the tolerance and healthy again on restart', async () => {
  const db = await createWorkerDatabase({ daysOld: 1 });
  databases.push(db);
  expect(metaWorkers(db.path).map((row) => row.status)).toEqual(['never', 'never']);

  const first = startCompiledWorker(db.path);
  processes.push(first);
  expect((await first.first).kind, first.output().stderr).toBe('ready');
  await expect.poll(() => lastPass(db.path), { timeout: 5000, interval: 25 }).toBeTypeOf('number');
  const workers = metaWorkers(db.path);
  expect(workers.find((row) => row.project_slug === 'alpha')).toMatchObject({ status: 'healthy' });
  expect(workers.find((row) => row.project_slug === 'beta')).toEqual({
    project_slug: 'beta',
    status: 'never',
    tolerance_seconds: 300,
  });
  expect(await first.stop()).toEqual({ code: 0, signal: null });

  const stopped = Number(lastPass(db.path));
  expect(workerStatus(stopped, stopped + WORKER_TOLERANCE_MS)).toBe('healthy');
  expect(workerStatus(stopped, stopped + WORKER_TOLERANCE_MS + 1)).toBe('stale');

  const second = startCompiledWorker(db.path);
  processes.push(second);
  expect((await second.first).kind, second.output().stderr).toBe('ready');
  await expect
    .poll(() => Number(lastPass(db.path)), { timeout: 5000, interval: 25 })
    .toBeGreaterThanOrEqual(stopped);
  expect(metaWorkers(db.path).find((row) => row.project_slug === 'alpha')?.status).toBe('healthy');
});
