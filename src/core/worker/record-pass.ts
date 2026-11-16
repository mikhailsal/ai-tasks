import { workerPasses } from '../../schema/worker.js';
import type { DatabaseConnection } from '../database/types.js';

/** Spec 011 R1: at most one write per project per minute and process. */
export const PASS_WRITE_INTERVAL_MS = 60_000;

/**
 * Records a completed pass. The last write wins, with no `max()`, so a clock moved back cannot
 * keep a stopped worker healthy. Not a mutation: no audit, no receipt, no `read_revision`.
 */
export function createPassRecorder(connection: DatabaseConnection, projectSlug: string) {
  let lastWrite: number | undefined;
  return (now: number): boolean => {
    if (lastWrite !== undefined && Math.abs(now - lastWrite) < PASS_WRITE_INTERVAL_MS) return false;
    connection.db
      .insert(workerPasses)
      .values({ projectSlug, lastPassAt: now })
      .onConflictDoUpdate({ target: workerPasses.projectSlug, set: { lastPassAt: now } })
      .run();
    lastWrite = now;
    return true;
  };
}
