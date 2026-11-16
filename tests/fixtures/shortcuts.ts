import { z } from 'zod/mini';
import type { OrdinaryFixture } from './ordinary-work.js';

/** Spec 009 test helpers. */
export function refusal(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

const auditRow = z.object({
  operation_id: z.string(),
  entity_type: z.string(),
  action: z.string(),
  changes: z.string(),
});
export function auditRows(fixture: OrdinaryFixture) {
  return z
    .array(auditRow)
    .parse(
      fixture.connection.sqlite
        .prepare(
          'SELECT operation_id, entity_type, action, changes FROM audit_records ORDER BY rowid',
        )
        .all(),
    );
}

export function occurrenceState(fixture: OrdinaryFixture, id: string) {
  return z
    .object({ state: z.string(), revision: z.number(), completion_note: z.nullable(z.string()) })
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT state, revision, completion_note FROM occurrences WHERE id = ?')
        .get(id),
    );
}
