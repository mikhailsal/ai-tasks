import * as z from 'zod/mini';
import type { ResponseMeta } from '../../schema/envelopes.js';
import { slugSchema, uuidSchema } from '../../schema/values.js';
import type { ConnectionLock } from '../database/lock-check.js';
import { queryMetadata, queryState } from '../queries/page.js';
import { readClock } from '../time.js';
import { openRecoveryConnection, verifyRecoveryLock } from './connections.js';
import { assertReadableAuditRecords } from './history.js';
import { snapshotMetadata, verifySnapshot } from './snapshot.js';
import type { RecoveryPhase } from './phase.js';

type InspectionOptions = {
  databasePath: string;
  lock: ConnectionLock;
  phase: RecoveryPhase;
  now: () => number;
};
export type RecoveryInspection =
  { state: 'new' | 'old'; meta: ResponseMeta } | { state: 'invalid' };

const restoreEventSchema = z.strictObject({
  id: uuidSchema,
  project_slug: slugSchema,
  entity_type: z.literal('database'),
  entity_id: uuidSchema,
  actor: z.string(),
  origin: z.string(),
});
function hasExpectedRestoreEvents(
  sqlite: ReturnType<typeof openRecoveryConnection>['sqlite'],
  phase: RecoveryPhase,
): boolean {
  const rows = z.array(restoreEventSchema).safeParse(
    sqlite
      .prepare(
        `
    SELECT id, project_slug, entity_type, entity_id, actor, origin FROM audit_records
    WHERE operation_id=? AND database_epoch=? AND action='database.restore'
    ORDER BY project_slug
  `,
      )
      .all(phase.identity.operation_id, phase.new_epoch),
  );
  if (!rows.success) return false;
  const ids = new Set(phase.result.audit_ids);
  const scopes = new Set(phase.result.affected_projects);
  if (
    ids.size !== rows.data.length ||
    scopes.size !== rows.data.length ||
    new Set(rows.data.map((row) => row.project_slug)).size !== scopes.size
  )
    return false;
  return rows.data.every(
    (row) =>
      ids.has(row.id) &&
      scopes.has(row.project_slug) &&
      row.entity_id === phase.new_epoch &&
      row.actor === phase.identity.actor &&
      row.origin === (phase.identity.actor === 'human-web' ? 'web' : 'cli'),
  );
}

function matchesOldMetadata(
  sqlite: ReturnType<typeof openRecoveryConnection>['sqlite'],
  phase: RecoveryPhase,
): boolean {
  const current = snapshotMetadata(sqlite);
  return (
    current.state.revision === phase.old_backup.settings_revision &&
    current.state.read_revision === phase.previous_meta.read_revision &&
    current.state.timezone === phase.previous_meta.timezone &&
    JSON.stringify(current.projects) === JSON.stringify(phase.old_backup.projects)
  );
}

/** Invalid lock proof is an error, never a reason to attempt recovery replacement.
 * Database verification itself remains readonly, including on a damaged header. */
export function inspectRecoveryLive(options: InspectionOptions): RecoveryInspection {
  verifyRecoveryLock(options.databasePath, options.lock);
  const instant = readClock(options.now);
  let connection: ReturnType<typeof openRecoveryConnection> | undefined;
  try {
    connection = openRecoveryConnection({
      databasePath: options.databasePath,
      lock: options.lock,
      role: 'read-live',
      now: () => instant,
    });
    verifySnapshot(connection.sqlite);
    assertReadableAuditRecords(connection.sqlite);
    const state = connection.db.transaction((transaction) => queryState(transaction));
    const meta = queryMetadata(state, instant);
    if (state.databaseEpoch === options.phase.new_epoch) {
      if (
        state.timezone !== options.phase.meta.timezone ||
        state.readRevision !== options.phase.meta.read_revision ||
        !hasExpectedRestoreEvents(connection.sqlite, options.phase)
      )
        return { state: 'invalid' };
      return { state: 'new', meta };
    }
    if (
      state.databaseEpoch === options.phase.identity.database_epoch &&
      matchesOldMetadata(connection.sqlite, options.phase)
    )
      return { state: 'old', meta };
    return { state: 'invalid' };
  } catch {
    return { state: 'invalid' };
  } finally {
    connection?.close();
  }
}

/** Publication calls this only after a closed readonly verification succeeds. */
export function configureRestoredLive(options: Omit<InspectionOptions, 'phase'>): void {
  const connection = openRecoveryConnection({
    databasePath: options.databasePath,
    lock: options.lock,
    role: 'write-live',
    now: options.now,
  });
  connection.close();
}
