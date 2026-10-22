import { createHash } from 'node:crypto';
import * as z from 'zod/mini';
import { createContext, createReadContext } from '../core/context.js';
import type { DatabaseConnection } from '../core/database/types.js';
import { DomainError } from '../core/errors.js';
import { discoverDueWork } from '../core/queries/due-work.js';
import { readMeta } from '../core/queries/meta.js';
import { tickRecurrence } from '../core/recurrence/tick.js';
import { mutationEnvelopeSchema, successEnvelopeSchema } from '../schema/envelopes.js';
/** Stable identity covers the exact core request, excluding the discovery clock/has_more. */
export function workerTickInput(
  projectSlug: string,
  discovered: ReturnType<typeof discoverDueWork>,
) {
  const request = {
    database_epoch: discovered.meta.database_epoch,
    expected_config_revision: discovered.data.expected_config_revision,
    expected_settings_revision: discovered.data.expected_settings_revision,
    payload: { tasks: discovered.data.tasks },
  };
  const hash = createHash('sha256')
    .update('ai-tasks:recurrence-worker:tick:v1:')
    .update(JSON.stringify({ project_slug: projectSlug, ...request }))
    .digest();
  // Version8 identifies this application's custom SHA-256 request-derived UUID.
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x80, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = hash.subarray(0, 16).toString('hex');
  const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return mutationEnvelopeSchema.parse({ operation_id: operationId, ...request });
}
const progressSchema = z.object({ has_more: z.boolean() });
const changedProposalCodes = new Set([
  'REVISION_CONFLICT',
  'CONFIG_CONFLICT',
  'DATABASE_EPOCH_CONFLICT',
]);
export function workerCallbacks(connection: DatabaseConnection, projectSlug: string) {
  const read = createReadContext({ connection });
  const context = createContext({
    connection,
    actor: `ai-cli:${projectSlug}`,
    origin: 'recurrence-worker',
  });
  let pending: ReturnType<typeof workerTickInput> | undefined;
  let selectedIds: string[] = [];
  let moreDiscovered = false;
  return {
    processBatch() {
      if (pending === undefined) {
        const discovered = discoverDueWork(read, projectSlug);
        if (discovered.data.tasks.length === 0) return { hasMore: false };
        pending = workerTickInput(projectSlug, discovered);
        selectedIds = discovered.data.tasks.map((task) => task.task_id);
        moreDiscovered = discovered.data.has_more;
      }
      try {
        const result = tickRecurrence(context, projectSlug, pending);
        pending = undefined;
        process.stderr.write('Recurring work processed\n');
        return { hasMore: progressSchema.parse(result.data).has_more || moreDiscovered };
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        if (changedProposalCodes.has(error.code)) {
          pending = undefined;
          process.stderr.write('Recurring work changed; refreshing saved revisions\n');
          return { hasMore: true };
        }
        if (error.code === 'DB_CONFLICT') {
          process.stderr.write('Database is busy; the same recurring proposal will be retried\n');
          return { hasMore: false };
        }
        if (error.code === 'VALIDATION_ERROR') {
          const fresh = discoverDueWork(read, projectSlug);
          const dueIds = new Set(fresh.data.tasks.map((task) => task.task_id));
          if (selectedIds.some((id) => !dueIds.has(id))) {
            pending = undefined;
            return { hasMore: fresh.data.tasks.length > 0 };
          }
        }
        throw error;
      }
    },
    readiness() {
      const metadata = readMeta(read, { all_projects: true });
      return successEnvelopeSchema.parse({
        ok: true,
        data: { project_slug: projectSlug, ...metadata.data },
        meta: metadata.meta,
      });
    },
  };
}
