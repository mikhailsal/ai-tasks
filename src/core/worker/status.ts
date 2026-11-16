import { eq, inArray } from 'drizzle-orm';
import { workerPasses } from '../../schema/worker.js';
import type { DatabaseConnection, DatabaseTransaction } from '../database/types.js';
import { formatTimestamp } from '../clock.js';

/** Spec 011 R2: ten missed 30 s intervals; one constant on every surface. */
export const WORKER_TOLERANCE_MS = 300_000;
export type WorkerStatus = 'healthy' | 'stale' | 'never';
type Database = DatabaseConnection['db'] | DatabaseTransaction;

/** Computed on read; a pass in the future (clock moved back) counts as healthy. */
export function workerStatus(lastPassAt: number | null, now: number): WorkerStatus {
  if (lastPassAt === null) return 'never';
  return now - lastPassAt > WORKER_TOLERANCE_MS ? 'stale' : 'healthy';
}

export function lastPasses(database: Database, slugs: readonly string[]): Map<string, number> {
  if (slugs.length === 0) return new Map();
  return new Map(
    database
      .select()
      .from(workerPasses)
      .where(inArray(workerPasses.projectSlug, [...slugs]))
      .all()
      .map((row) => [row.projectSlug, row.lastPassAt]),
  );
}

/** `{status, last_pass_at?}` for one project, as project resources show it. */
export function projectWorker(database: Database, slug: string, now: number) {
  const last =
    database
      .select({ at: workerPasses.lastPassAt })
      .from(workerPasses)
      .where(eq(workerPasses.projectSlug, slug))
      .get()?.at ?? null;
  return workerView(last, now);
}

export function workerView(last: number | null, now: number) {
  return {
    status: workerStatus(last, now),
    ...(last === null ? {} : { last_pass_at: formatTimestamp(last) }),
  };
}
