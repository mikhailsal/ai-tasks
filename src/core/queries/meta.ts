import { eq } from 'drizzle-orm';
import { applicationState } from '../../schema/entities.js';
import { metaEnvelopeSchema } from '../../schema/meta.js';
import { readScopeSchema } from '../../schema/scopes.js';
import type { CoreContext } from '../database/types.js';
import { domainError } from '../errors.js';
import { formatTimestamp } from '../time.js';

export function readMeta(
  context: Pick<CoreContext, 'connection' | 'now'>,
  scope: { all_projects: true },
) {
  const parsedScope = readScopeSchema.parse(scope);
  if (!('all_projects' in parsedScope)) {
    throw domainError('VALIDATION_ERROR', 'Metadata requires explicit all-projects scope');
  }
  const state = context.connection.db
    .select()
    .from(applicationState)
    .where(eq(applicationState.id, 1))
    .get();
  if (!state) throw domainError('INTERNAL_ERROR', 'Database metadata is unavailable');
  const result = metaEnvelopeSchema.safeParse({
    ok: true,
    data: {
      database_epoch: state.databaseEpoch,
      timezone: state.timezone,
      settings_revision: state.revision,
      contract_version: 1,
      schema_version: state.schemaVersion,
      maintenance: false,
    },
    meta: {
      database_epoch: state.databaseEpoch,
      timezone: state.timezone,
      now: formatTimestamp(context.now()),
      read_revision: state.readRevision,
    },
  });
  if (!result.success) throw domainError('INTERNAL_ERROR', 'Database metadata is invalid');
  return result.data;
}
