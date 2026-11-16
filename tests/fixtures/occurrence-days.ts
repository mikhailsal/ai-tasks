import { z } from 'zod/mini';
import { completeOccurrences } from '../../src/core/recurrence/complete.js';
import type { CoreContext } from '../../src/core/database/types.js';
import { outcomeInput, seedOccurrence, type OutcomeParent } from './occurrence-outcomes.js';
import type { OrdinaryFixture } from './ordinary-work.js';

/** Spec 008 helpers: rows with a chosen day and outcome, built through real completion. */
export type DayState = 'pending' | 'debt' | 'missed' | 'completed' | 'completed_late';

export function readContext(fixture: OrdinaryFixture): Pick<CoreContext, 'connection' | 'now'> {
  return { connection: fixture.connection, now: () => fixture.clock.now() };
}

export function rowRevision(fixture: OrdinaryFixture, id: string): number {
  return z
    .number()
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT revision FROM occurrences WHERE id = ?')
        .pluck()
        .get(id),
    );
}

/** One occurrence on `day` in `state`. Completed rows need a parent with a long window. */
export function seedDay(
  fixture: OrdinaryFixture,
  parent: OutcomeParent,
  day: string,
  state: DayState,
): string {
  const seeded: 'pending' | 'debt' | 'missed' =
    state === 'completed' ? 'pending' : state === 'completed_late' ? 'missed' : state;
  const row = seedOccurrence(fixture, parent, {
    deadline: fixture.clock.now() + 3600000,
    state: seeded,
  });
  fixture.connection.sqlite
    .prepare('UPDATE occurrences SET occurrence_day = ? WHERE id = ?')
    .run(day, row.id);
  if (state === 'completed' || state === 'completed_late')
    completeOccurrences(
      fixture.human,
      parent.slug,
      parent.id,
      outcomeInput(fixture, parent.id, {
        occurrences: [{ id: row.id, expected_revision: rowRevision(fixture, row.id) }],
      }),
    );
  return row.id;
}
