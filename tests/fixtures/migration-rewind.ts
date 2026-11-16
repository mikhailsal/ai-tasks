import type Database from 'better-sqlite3';

/** Journal times of migrations that tests replay on a populated database. */
export const migrationTimes = {
  ordinaryCompletionTime: 1792627200000,
  sharedBoardOrder: 1792710618222,
  occurrenceReasons: 1794823297325,
  occurrenceDay: 1794824922838,
} as const;

/** Undoes 0005 (spec 008). */
function undoOccurrenceDay(sqlite: Database.Database): void {
  sqlite.exec(`
    DROP INDEX occurrences_task_day_idx;
    ALTER TABLE occurrences DROP COLUMN occurrence_day;
    ALTER TABLE occurrences DROP COLUMN recorded_values;
    ALTER TABLE recurrence_state DROP COLUMN value_declarations;
    ALTER TABLE projects DROP COLUMN day_start_hour;`);
}

/** Undoes 0004 (spec 007). A column that another column's CHECK names is dropped last. */
function undoOccurrenceReasons(sqlite: Database.Database): void {
  sqlite.exec(`
    ALTER TABLE occurrences DROP COLUMN miss_reason_recorded_at;
    ALTER TABLE occurrences DROP COLUMN completion_note;
    ALTER TABLE occurrences DROP COLUMN miss_reason;`);
}

/**
 * Undoes the schema of `from` and every later migration, and forgets their journal rows, so
 * `migrateDatabase` replays them on the populated database. Drizzle resumes after the newest
 * recorded migration, so later rows must go too.
 */
export function rewindMigrations(
  sqlite: Database.Database,
  from: keyof typeof migrationTimes,
): void {
  const time = migrationTimes[from];
  undoOccurrenceDay(sqlite);
  if (time <= migrationTimes.occurrenceReasons) undoOccurrenceReasons(sqlite);
  sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at >= ?').run(time);
}
