import { and, eq, inArray } from 'drizzle-orm';
import * as z from 'zod/mini';
import { applicationState, projectConfigs, projects } from '../../schema/entities.js';
import { paginationSecrets } from '../../schema/pagination.js';
import { projectConfigInputSchema } from '../../schema/configuration.js';
import {
  restoreResultSchema,
  type AffectedProject,
  type BackupInfo,
} from '../../schema/recovery.js';
import {
  jsonValueSchema,
  revisionSchema,
  uuidSchema,
  type JsonValue,
} from '../../schema/values.js';
import { appendAudit } from '../audit/append.js';
import type { CoreContext, DatabaseConnection, DatabaseTransaction } from '../database/types.js';
import { domainError, normalizeError } from '../errors.js';
import { queryState } from '../queries/page.js';
import { iterateRawAuditRecords, assertNoDivergentAuditIds } from './history.js';
import { assertRecoveryReservations } from './reservations.js';
import { rebuildStagedDescriptions } from './render.js';

export type StageInputs = {
  live: DatabaseConnection;
  stage: DatabaseConnection;
  backup: BackupInfo;
  context: CoreContext;
  operationId: string;
  confirmation: { asserted: true; user_text: string };
  affectedProjects: readonly AffectedProject[];
  newEpoch: string;
  recoverySnapshotId: string;
  now: number;
};
const reservationTrigger = 'project_emoji_reservations_immutable_update';
const reservationSchema = z.strictObject({
  emoji_key: z.string(),
  project_slug: z.string(),
  emoji: z.string(),
  first_reserved_at: z.int(),
});
const completionSchema = z.strictObject({
  id: uuidSchema,
  completion_recorded_at: z.nullable(z.int()),
});

function unionAudit(input: StageInputs): void {
  assertNoDivergentAuditIds(input.live.sqlite, input.stage.sqlite);
  const insert = input.stage.sqlite.prepare(`INSERT INTO audit_records (
    id,operation_id,project_slug,entity_type,entity_id,actor,origin,timestamp,
    action,changes,config_snapshot,confirmation,database_epoch
  ) VALUES (@id,@operation_id,@project_slug,@entity_type,@entity_id,@actor,@origin,@timestamp,
    @action,@changes,@config_snapshot,@confirmation,@database_epoch) ON CONFLICT(id) DO NOTHING`);
  // Persist the original JSON text, including whitespace and key order, without decoding it.
  for (const row of iterateRawAuditRecords(input.live.sqlite)) insert.run(row);
}
function triggerDefinition(connection: DatabaseConnection): string {
  const found = z
    .object({ sql: z.string() })
    .safeParse(
      connection.sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
        .get(reservationTrigger),
    );
  if (!found.success)
    throw domainError('INTERNAL_ERROR', 'The immutable reservation guard is unavailable');
  return found.data.sql;
}
function unionReservations(input: StageInputs): void {
  assertRecoveryReservations(input.live.sqlite, input.stage.sqlite);
  const original = triggerDefinition(input.stage);
  const upsert = input.stage.sqlite.prepare(`INSERT INTO project_emoji_reservations
    (emoji_key,project_slug,emoji,first_reserved_at) VALUES (@emoji_key,@project_slug,@emoji,@first_reserved_at)
    ON CONFLICT(emoji_key) DO UPDATE SET project_slug=excluded.project_slug,
    emoji=excluded.emoji,first_reserved_at=excluded.first_reserved_at`);
  input.stage.sqlite.exec(`DROP TRIGGER "${reservationTrigger}"`);
  try {
    for (const row of input.live.sqlite
      .prepare(
        'SELECT emoji_key,project_slug,emoji,first_reserved_at FROM project_emoji_reservations ORDER BY emoji_key',
      )
      .iterate()) {
      upsert.run(reservationSchema.parse(row));
    }
  } finally {
    input.stage.sqlite.exec(original);
  }
  if (triggerDefinition(input.stage) !== original)
    throw domainError('INTERNAL_ERROR', 'The immutable reservation guard could not be restored');
}
function preserveCompletionFacts(input: StageInputs): void {
  const update = input.stage.sqlite.prepare('UPDATE tasks SET completion_recorded_at=? WHERE id=?');
  const select = input.live.sqlite.prepare(
    'SELECT id,completion_recorded_at FROM tasks WHERE id>? ORDER BY id LIMIT 128',
  );
  let cursor = '';
  for (;;) {
    const page = z.array(completionSchema).parse(select.all(cursor));
    const last = page.at(-1);
    if (!last) return;
    // NULL is also the authoritative live fact; a restored completed row may be undated.
    for (const row of page) update.run(row.completion_recorded_at, row.id);
    cursor = last.id;
  }
}
function scopedConfigurations(
  database: DatabaseConnection['db'] | DatabaseTransaction,
  slugs: string[],
) {
  const rows = database
    .select({
      slug: projects.slug,
      revision: projects.revision,
      configRevision: projects.configRevision,
      config: {
        priority: projectConfigs.priorityModel,
        ordinary: projectConfigs.ordinaryWorkflow,
        recurring: projectConfigs.recurringWorkflow,
      },
    })
    .from(projects)
    .leftJoin(
      projectConfigs,
      and(
        eq(projectConfigs.projectSlug, projects.slug),
        eq(projectConfigs.revision, projects.configRevision),
      ),
    )
    .where(inArray(projects.slug, slugs))
    .all();
  return new Map(
    rows.map((row) => {
      if (!row.config)
        throw domainError('INTERNAL_ERROR', 'The project configuration is unavailable');
      const config = projectConfigInputSchema.parse({
        priority_model: row.config.priority,
        ordinary_workflow: row.config.ordinary,
        recurring_workflow: row.config.recurring,
      });
      return [
        row.slug,
        {
          revision: row.revision,
          configRevision: row.configRevision,
          semantic: jsonValueSchema.parse({ revision: row.configRevision, ...config }),
        },
      ] as const;
    }),
  );
}
function semanticSnapshot(
  current: JsonValue | undefined,
  previous: JsonValue | undefined,
): JsonValue {
  const chosen = current ?? previous;
  if (!chosen || typeof chosen !== 'object' || Array.isArray(chosen))
    throw domainError('INTERNAL_ERROR', 'The recovery audit configuration is unavailable');
  return jsonValueSchema.parse({ ...chosen, previous: previous ?? null });
}
function scopeVersions(scope: { revision: number; configRevision: number } | undefined) {
  return { revision: scope?.revision ?? null, configRevision: scope?.configRevision ?? null };
}
function appendRestoreAudit(
  transaction: DatabaseTransaction,
  input: StageInputs,
  oldEpoch: string,
): string[] {
  const auditIds: string[] = [];
  // Full configuration graphs stay within sixteen scopes at a time.
  for (let offset = 0; offset < input.affectedProjects.length; offset += 16) {
    const slugs = input.affectedProjects
      .slice(offset, offset + 16)
      .map((project) => project.project_slug);
    const before = scopedConfigurations(input.live.db, slugs);
    const after = scopedConfigurations(transaction, slugs);
    for (const slug of slugs) {
      const previousVersions = scopeVersions(before.get(slug));
      const currentVersions = scopeVersions(after.get(slug));
      auditIds.push(
        ...appendAudit(transaction, {
          context: input.context,
          operationId: input.operationId,
          projectSlug: slug,
          databaseEpoch: input.newEpoch,
          timestamp: input.now,
          events: [
            {
              entity_type: 'database',
              entity_id: input.newEpoch,
              action: 'database.restore',
              confirmation: input.confirmation,
              config_snapshot: semanticSnapshot(
                after.get(slug)?.semantic,
                before.get(slug)?.semantic,
              ),
              changes: [
                { field: 'database_epoch', before: oldEpoch, after: input.newEpoch },
                { field: 'backup_id', before: null, after: input.backup.id },
                {
                  field: 'project_revision',
                  before: previousVersions.revision,
                  after: currentVersions.revision,
                },
                {
                  field: 'config_revision',
                  before: previousVersions.configRevision,
                  after: currentVersions.configRevision,
                },
              ],
            },
          ],
        }),
      );
    }
  }
  return auditIds;
}
/** The private stage changes atomically; prepare owns live locks, copies and publication. */
export function stageRestore(input: StageInputs) {
  try {
    if (
      input.context.connection !== input.stage ||
      input.stage.sqlite === input.live.sqlite ||
      input.stage.sqlite.name === input.live.sqlite.name
    )
      throw domainError(
        'INTERNAL_ERROR',
        'Recovery staging requires an independent private database',
      );
    uuidSchema.parse(input.newEpoch);
    return input.stage.db.transaction(
      (transaction) => {
        const live = input.live.db.transaction((liveTransaction) => queryState(liveTransaction));
        const snapshot = queryState(transaction);
        if (input.newEpoch === live.databaseEpoch || input.newEpoch === snapshot.databaseEpoch)
          throw domainError('INTERNAL_ERROR', 'Recovery must establish a new database epoch');
        const readRevision = revisionSchema.parse(
          Math.max(live.readRevision, snapshot.readRevision) + 1,
        );
        unionAudit(input);
        unionReservations(input);
        preserveCompletionFacts(input);
        transaction
          .update(paginationSecrets)
          .set({ secret: live.cursorSecret })
          .where(eq(paginationSecrets.id, 1))
          .run();
        rebuildStagedDescriptions(transaction);
        transaction
          .update(applicationState)
          .set({ databaseEpoch: input.newEpoch, readRevision, updatedAt: input.now })
          .where(eq(applicationState.id, 1))
          .run();
        const auditIds = appendRestoreAudit(transaction, input, live.databaseEpoch);
        return restoreResultSchema.parse({
          database_epoch: input.newEpoch,
          affected_projects: input.affectedProjects.map((project) => project.project_slug),
          audit_ids: auditIds,
          recovery_snapshot_id: input.recoverySnapshotId,
        });
      },
      { behavior: 'immediate' },
    );
  } catch (error) {
    throw normalizeError(error);
  }
}
