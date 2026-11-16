import { afterEach, beforeEach, expect, it } from 'vitest';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { backfillOccurrenceDays } from '../../src/core/database/backfill-days.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';
import { seedOccurrence, seedOutcomeParent } from '../fixtures/occurrence-outcomes.js';
import { rewindMigrations } from '../fixtures/migration-rewind.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';

/** Spec 008: 0005 plus the code backfill upgrade a populated schema-4 database. */
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

const rows = () => fixture.connection.sqlite.prepare('SELECT * FROM occurrences ORDER BY id').all();

it('fills each old occurrence day from its deadline in its zone with the midnight rule', () => {
  const parent = seedOutcomeParent(fixture, {});
  // Moscow is UTC+3: 20:59 UTC is still the 10th, 21:00 UTC is already the 11th.
  const late = seedOccurrence(fixture, parent, { deadline: Date.parse('2026-11-10T20:59:00Z') });
  const midnight = seedOccurrence(fixture, parent, {
    deadline: Date.parse('2026-11-10T21:00:00Z'),
    state: 'debt',
  });
  rewindMigrations(fixture.connection.sqlite, 'occurrenceDay');
  const before = rows();
  migrateDatabase(fixture.connection);
  const day = (id: string) =>
    fixture.connection.sqlite
      .prepare('SELECT occurrence_day FROM occurrences WHERE id = ?')
      .pluck()
      .get(id);
  expect(day(late.id)).toBe('2026-11-10');
  expect(day(midnight.id)).toBe('2026-11-11');
  expect(rows()).toEqual(
    before.map((row) => ({
      ...Object(row),
      occurrence_day: expect.any(String),
      recorded_values: null,
    })),
  );
  expect(
    fixture.connection.sqlite.prepare('SELECT DISTINCT day_start_hour FROM projects').pluck().all(),
  ).toEqual([0]);
  // Idempotent: nothing is left to fill, and a stored day is never recomputed.
  fixture.connection.sqlite
    .prepare("UPDATE occurrences SET occurrence_day = '2000-01-01' WHERE id = ?")
    .run(late.id);
  expect(backfillOccurrenceDays(fixture.connection)).toBe(0);
  expect(day(late.id)).toBe('2000-01-01');
});

it('the new constraints refuse a bad day, values on a pending row and an hour of 24', () => {
  const parent = seedOutcomeParent(fixture, {});
  const pending = seedOccurrence(fixture, parent, {});
  const run =
    (sql: string, ...args: string[]) =>
    () =>
      fixture.connection.sqlite.prepare(sql).run(...args);
  expect(
    run("UPDATE occurrences SET occurrence_day = '10.11.2026' WHERE id = ?", pending.id),
  ).toThrow(/CHECK constraint failed/u);
  expect(
    run(`UPDATE occurrences SET recorded_values = '{"a":1}' WHERE id = ?`, pending.id),
  ).toThrow(/CHECK constraint failed/u);
  expect(run('UPDATE projects SET day_start_hour = 24')).toThrow(/CHECK constraint failed/u);
  expect(
    run(`UPDATE recurrence_state SET value_declarations = '{}' WHERE task_id = ?`, parent.id),
  ).toThrow(/CHECK constraint failed/u);
});
