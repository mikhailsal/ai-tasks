import type Database from 'better-sqlite3';

/** Journal times of migrations that tests replay on a populated database. */
export const migrationTimes = {
  ordinaryCompletionTime: 1792627200000,
  sharedBoardOrder: 1792710618222,
  occurrenceReasons: 1794823297325,
} as const;

/** Undoes 0004 so an earlier migration can be replayed; Drizzle reruns every later one. */
export function dropOccurrenceReasons(sqlite: Database.Database): void {
  // A column that a CHECK of another column names must be dropped after that column.
  sqlite.exec(`
    ALTER TABLE occurrences DROP COLUMN miss_reason_recorded_at;
    ALTER TABLE occurrences DROP COLUMN completion_note;
    ALTER TABLE occurrences DROP COLUMN miss_reason;`);
}
