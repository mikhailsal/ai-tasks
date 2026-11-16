import { afterEach, beforeEach, expect, it } from 'vitest';
import { backfillOccurrenceDays } from '../../src/core/database/backfill-days.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { rewindMigrations } from '../fixtures/migration-rewind.js';
import { seedOccurrence, seedOutcomeParent } from '../fixtures/occurrence-outcomes.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';

/** Spec 011: 0006 adds an empty pass table to a populated schema-5 database. */
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

it('upgrades a populated database: data intact, no passes, every worker reads as never', () => {
  const parent = seedOutcomeParent(fixture, {});
  seedOccurrence(fixture, parent, {});
  const sqlite = fixture.connection.sqlite;
  const dump = () => ({
    tasks: sqlite.prepare('SELECT * FROM tasks ORDER BY id').all(),
    occurrences: sqlite.prepare('SELECT * FROM occurrences ORDER BY id').all(),
    state: sqlite.prepare('SELECT * FROM application_state').all(),
  });
  backfillOccurrenceDays(fixture.connection); // seeded rows predate the day fill of 0005
  rewindMigrations(sqlite, 'workerPasses');
  const before = dump();
  migrateDatabase(fixture.connection);
  expect(dump()).toEqual(before);
  expect(sqlite.prepare('SELECT count(*) FROM worker_passes').pluck().get()).toBe(0);
  expect(() => sqlite.prepare("INSERT INTO worker_passes VALUES ('alpha', 'soon')").run()).toThrow(
    /CHECK constraint failed/u,
  );
  expect(() => sqlite.prepare("INSERT INTO worker_passes VALUES ('missing', 1)").run()).toThrow(
    /FOREIGN KEY/u,
  );
});
