import type { openDatabase } from './open.js';
import { occurrenceDay } from '../recurrence/day.js';

const batch = 1000;

/**
 * Fills `occurrence_day` of rows created before spec 008 with the default rule (hour 0), in
 * their generation's zone. SQLite cannot evaluate IANA zones, so this runs after the SQL
 * migrations. Idempotent: only NULL days are written, and stored days are never recomputed.
 */
export function backfillOccurrenceDays(connection: ReturnType<typeof openDatabase>): number {
  const select = connection.sqlite.prepare<
    [number],
    { id: string; deadline: number; timezone: string }
  >(
    `SELECT o.id, o.deadline, g.timezone FROM occurrences AS o
     JOIN schedule_generations AS g ON g.id = o.generation_id
     WHERE o.occurrence_day IS NULL LIMIT ?`,
  );
  const update = connection.sqlite.prepare<[string, string]>(
    'UPDATE occurrences SET occurrence_day = ? WHERE id = ? AND occurrence_day IS NULL',
  );
  let filled = 0;
  for (;;) {
    const rows = connection.sqlite
      .transaction(() => {
        const found = select.all(batch);
        for (const row of found) update.run(occurrenceDay(row.deadline, row.timezone), row.id);
        return found.length;
      })
      .immediate();
    filled += rows;
    if (rows < batch) return filled;
  }
}
