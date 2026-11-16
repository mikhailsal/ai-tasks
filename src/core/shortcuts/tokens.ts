import type { projects, tasks } from '../../schema/entities.js';
import { currentState } from '../database/mutate.js';
import { requirementsFor } from '../database/mutation-requirements.js';
import { requiredRevisions } from '../database/required-revisions.js';
import type { DatabaseTransaction } from '../database/types.js';

/** The revision values the strict write needs, read under the shortcut's own lock (spec 009 R1). */
export function strictTokens(
  transaction: DatabaseTransaction,
  operation: string,
  target: { task: typeof tasks.$inferSelect; project: typeof projects.$inferSelect },
) {
  const fields = requiredRevisions(requirementsFor(operation), {
    recurring: target.task.kind === 'recurring',
  });
  const values = {
    expected_revision: target.task.revision,
    expected_config_revision: target.project.configRevision,
    expected_settings_revision: currentState(transaction).revision,
  };
  return Object.fromEntries(
    Object.entries(values).filter(([field]) => fields.some((name) => name === field)),
  );
}
