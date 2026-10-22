import { eq } from 'drizzle-orm';
import { applicationState } from '../../schema/entities.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { readScopeSchema, type ReadScope } from '../../schema/scopes.js';
import { settingsEnvelopeSchema, settingsInputSchema } from '../../schema/settings.js';
import { executeMutation } from '../database/mutate.js';
import type { CoreContext } from '../database/types.js';
import { queryMetadata, queryState } from '../queries/page.js';
import { recurrenceSettings } from '../recurrence/generations.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { requireProject } from './read.js';
import { versionCalendarTimezones } from './timezone-generations.js';

export function settingsResource(state: typeof applicationState.$inferSelect) {
  return {
    timezone: state.timezone,
    revision: state.revision,
    database_epoch: state.databaseEpoch,
  };
}

export function getSettings(context: Pick<CoreContext, 'connection' | 'now'>, scope: ReadScope) {
  const parsed = parseInput(readScopeSchema, scope);
  return context.connection.db.transaction((transaction) => {
    if ('project_slug' in parsed) requireProject(transaction, parsed.project_slug);
    const state = queryState(transaction);
    return settingsEnvelopeSchema.parse({
      ok: true,
      data: settingsResource(state),
      meta: queryMetadata(state, readClock(context.now)),
    });
  });
}

/** The project supplies attribution/configuration, including when it is archived. */
export function updateSettings(context: CoreContext, projectSlug: string, input: MutationEnvelope) {
  return executeMutation({
    context,
    projectSlug,
    input,
    operation: 'settings.update',
    guards: { settings: true },
    handler(transaction, now) {
      const payload = parseInput(settingsInputSchema, input.payload);
      const before = recurrenceSettings(transaction);
      const events =
        before.timezone === payload.timezone
          ? []
          : versionCalendarTimezones(transaction, { timezone: payload.timezone, now });
      transaction
        .update(applicationState)
        .set({ timezone: payload.timezone, revision: before.revision + 1 })
        .where(eq(applicationState.id, 1))
        .run();
      const after = recurrenceSettings(transaction);
      return {
        data: settingsResource(after),
        events: [
          ...events,
          {
            entity_type: 'settings',
            entity_id: before.databaseEpoch,
            action: 'settings.update',
            changes: [
              { field: 'timezone', before: before.timezone, after: after.timezone },
              { field: 'revision', before: before.revision, after: after.revision },
            ],
          },
        ],
      };
    },
  });
}
