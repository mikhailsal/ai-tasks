import { eq, sql } from 'drizzle-orm';
import * as z from 'zod/mini';
import { applicationState } from '../../schema/entities.js';
import {
  mutationEnvelopeSchema,
  mutationSuccessEnvelopeSchema,
  type MutationEnvelope,
} from '../../schema/envelopes.js';
import {
  jsonValueSchema,
  slugSchema,
  validateJsonBodySize,
  type JsonValue,
} from '../../schema/values.js';
import { appendAudit, type AuditEvent } from '../audit/append.js';
import { findReceipt, fingerprintRequest, storeReceipt } from '../audit/receipts.js';
import { domainError, normalizeError } from '../errors.js';
import { formatTimestamp } from '../time.js';
import { enforceMutationGuards, mutationGuardsSchema } from './guards.js';
import type { CoreContext, DatabaseTransaction } from './types.js';
type MutationCommand = {
  context: CoreContext;
  operation: string;
  projectSlug: string;
  input: MutationEnvelope;
  guards?: z.input<typeof mutationGuardsSchema>;
  handler: (
    transaction: DatabaseTransaction,
    now: number,
  ) => {
    data: JsonValue;
    events: AuditEvent[];
  };
};
function parseCommand(command: MutationCommand) {
  try {
    return {
      input: mutationEnvelopeSchema.parse(
        validateJsonBodySize(jsonValueSchema.parse(command.input)),
      ),
      projectSlug: slugSchema.parse(command.projectSlug),
      guards: mutationGuardsSchema.parse(command.guards ?? {}),
      operation: z.string().check(z.minLength(1)).parse(command.operation),
    };
  } catch (error) {
    throw normalizeError(error);
  }
}
function currentState(transaction: DatabaseTransaction) {
  const state = transaction.select().from(applicationState).where(eq(applicationState.id, 1)).get();
  if (!state) throw domainError('INTERNAL_ERROR', 'The database must be migrated before use');
  return state;
}
/** Every state write, immutable event and receipt shares this synchronous transaction. */
export function executeMutation(command: MutationCommand) {
  const { context } = command;
  const { input, projectSlug, guards, operation } = parseCommand(command);
  const requestHash = fingerprintRequest({
    operation,
    project_slug: projectSlug,
    actor: context.actor,
    origin: context.origin,
    input,
    target: guards.entity ?? null,
  });
  try {
    return context.connection.db.transaction(
      (transaction) => {
        const state = currentState(transaction);
        if (state.databaseEpoch !== input.database_epoch) {
          throw domainError(
            'DATABASE_EPOCH_CONFLICT',
            'The database has been restored or replaced',
            {
              current_database_epoch: state.databaseEpoch,
            },
          );
        }
        const replay = findReceipt(transaction, {
          database_epoch: input.database_epoch,
          operation_id: input.operation_id,
          request_hash: requestHash,
        });
        if (replay) return replay;
        enforceMutationGuards(transaction, {
          context,
          projectSlug,
          input,
          guards,
          settingsRevision: state.revision,
        });
        const now = context.now();
        const outcome = command.handler(transaction, now);
        const auditIds = appendAudit(transaction, {
          context,
          operationId: input.operation_id,
          projectSlug,
          databaseEpoch: state.databaseEpoch,
          timestamp: now,
          events: outcome.events,
        });
        transaction
          .update(applicationState)
          .set({ readRevision: sql`${applicationState.readRevision} + 1`, updatedAt: now })
          .where(eq(applicationState.id, 1))
          .run();
        const committed = currentState(transaction);
        if (committed.databaseEpoch !== state.databaseEpoch) {
          throw domainError(
            'INTERNAL_ERROR',
            'Ordinary mutations cannot replace the database epoch',
          );
        }
        const result = mutationSuccessEnvelopeSchema.parse({
          ok: true,
          data: jsonValueSchema.parse(outcome.data),
          meta: {
            database_epoch: committed.databaseEpoch,
            timezone: committed.timezone,
            now: formatTimestamp(now),
            read_revision: committed.readRevision,
            operation_id: input.operation_id,
            audit_ids: auditIds,
          },
        });
        storeReceipt(transaction, {
          request_hash: requestHash,
          actor: context.actor,
          project_slug: projectSlug,
          operation,
          result,
          committed_at: now,
        });
        return result;
      },
      { behavior: 'immediate' },
    );
  } catch (error) {
    // Keep authored handler failures visible in direct core tests. Transport boundaries
    // scrub all unexpected diagnostics; exhausted native lock waits are domain conflicts.
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^SQLITE_(?:BUSY|LOCKED)(?:_[A-Z0-9]+)*$/u.test(error.code)
    )
      throw normalizeError(error);
    throw error;
  }
}
