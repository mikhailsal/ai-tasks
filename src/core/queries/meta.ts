import { asc, eq, isNull } from 'drizzle-orm';
import { applicationState, projects } from '../../schema/entities.js';
import { metaEnvelopeSchema } from '../../schema/meta.js';
import { readScopeSchema } from '../../schema/scopes.js';
import type { CoreContext, DatabaseConnection } from '../database/types.js';
import { lastPasses, workerView, WORKER_TOLERANCE_MS } from '../worker/status.js';
import { domainError } from '../errors.js';
import { formatTimestamp } from '../clock.js';

/** Spec 011 R3: status of every active project's worker, computed at read time. */
function metaWorkers(database: DatabaseConnection['db'], now: number) {
  const active = database
    .select({ slug: projects.slug })
    .from(projects)
    .where(isNull(projects.archivedAt))
    .orderBy(asc(projects.slug))
    .all()
    .map((row) => row.slug);
  const passes = lastPasses(database, active);
  return active.map((slug) => ({
    project_slug: slug,
    ...workerView(passes.get(slug) ?? null, now),
    tolerance_seconds: WORKER_TOLERANCE_MS / 1000,
  }));
}
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
      workers: metaWorkers(context.connection.db, context.now()),
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
