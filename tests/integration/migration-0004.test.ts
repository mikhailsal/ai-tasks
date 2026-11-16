import { afterEach, beforeEach, expect, it } from 'vitest';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';
import { seedOccurrence, seedOutcomeParent } from '../fixtures/occurrence-outcomes.js';
import { rewindMigrations } from '../fixtures/migration-rewind.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';

/** Spec 007: 0004 upgrades a populated schema-3 database without rewriting rows. */
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

function rewindTo0003() {
  rewindMigrations(fixture.connection.sqlite, 'occurrenceReasons');
}

it('adds the reason and note columns as NULL and keeps every existing row', () => {
  const parent = seedOutcomeParent(fixture, {});
  seedOccurrence(fixture, parent, { state: 'debt', deadline: fixture.clock.now() - 86400000 });
  seedOccurrence(fixture, parent, { deadline: fixture.clock.now() + 86400000 });
  rewindTo0003();
  const before = fixture.connection.sqlite.prepare('SELECT * FROM occurrences ORDER BY id').all();
  migrateDatabase(fixture.connection);
  const after = fixture.connection.sqlite.prepare('SELECT * FROM occurrences ORDER BY id').all();
  expect(after).toEqual(
    before.map((row) => ({
      ...Object(row),
      miss_reason: null,
      miss_reason_recorded_at: null,
      completion_note: null,
      occurrence_day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
      recorded_values: null,
    })),
  );
});

it('the new constraints refuse a reason on a pending row and an empty note', () => {
  const parent = seedOutcomeParent(fixture, {});
  const pending = seedOccurrence(fixture, parent, {});
  const update = (sql: string) => () => fixture.connection.sqlite.prepare(sql).run(pending.id);
  expect(
    update("UPDATE occurrences SET miss_reason = 'x', miss_reason_recorded_at = 1 WHERE id = ?"),
  ).toThrow(/CHECK constraint failed/u);
  expect(update("UPDATE occurrences SET completion_note = ' ' WHERE id = ?")).toThrow(
    /CHECK constraint failed/u,
  );
});
