import { mutationEnvelopeSchema, type MutationEnvelope } from '../../schema/envelopes.js';
import { jsonValueSchema, slugSchema, validateJsonBodySize } from '../../schema/values.js';
import { fingerprintRequest } from '../audit/receipts.js';
import { enforceMutationGuards } from '../database/guards.js';
import type { CoreContext } from '../database/types.js';
import { domainError } from '../errors.js';
import { parseInput } from '../validation.js';
import { queryMetadata, queryState } from '../queries/page.js';

export type RecoveryReadContext = Pick<CoreContext, 'connection' | 'now'>;
export function recoveryRead(context: RecoveryReadContext) {
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    return { state, meta: queryMetadata(state, context.now()) };
  });
}
export function recoveryMutation(
  context: CoreContext,
  projectSlug: string,
  envelope: MutationEnvelope,
  operation: 'backup.create' | 'backup.restore',
) {
  const project = parseInput(slugSchema, projectSlug);
  const input = parseInput(
    mutationEnvelopeSchema,
    validateJsonBodySize(jsonValueSchema.parse(envelope)),
  );
  const current = recoveryRead(context);
  if (current.state.databaseEpoch !== input.database_epoch)
    throw domainError('DATABASE_EPOCH_CONFLICT', 'The database has been restored or replaced', {
      current_database_epoch: current.state.databaseEpoch,
    });
  const requestHash = fingerprintRequest({
    operation,
    project_slug: project,
    actor: context.actor,
    origin: context.origin,
    input,
    target: null,
  });
  return {
    ...current,
    project,
    input,
    identity: {
      database_epoch: input.database_epoch,
      operation_id: input.operation_id,
      request_hash: requestHash,
      project_slug: project,
      actor: context.actor,
      operation,
    },
  };
}
export function guardRecoveryMutation(
  context: CoreContext,
  projectSlug: string,
  input: MutationEnvelope,
) {
  context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    if (state.databaseEpoch !== input.database_epoch)
      throw domainError('DATABASE_EPOCH_CONFLICT', 'The database has been restored or replaced', {
        current_database_epoch: state.databaseEpoch,
      });
    enforceMutationGuards(transaction, {
      context,
      projectSlug,
      input,
      guards: { settings: true },
      settingsRevision: state.revision,
    });
  });
}
