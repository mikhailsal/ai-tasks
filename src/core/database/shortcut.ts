import { randomUUID } from 'node:crypto';
import { successEnvelopeSchema, type MutationEnvelope } from '../../schema/envelopes.js';
import type { JsonValue } from '../../schema/values.js';
import { formatTimestamp } from '../time.js';
import {
  commitMutation,
  currentState,
  hashCommand,
  lockFailure,
  parseCommand,
  type MutationCommand,
} from './mutate.js';
import type { CoreContext, DatabaseTransaction } from './types.js';

/** What a shortcut's resolver found: the strict write to run, or the effect already present. */
export type Resolution =
  | {
      kind: 'write';
      tokens: Omit<MutationEnvelope, 'operation_id' | 'database_epoch' | 'payload'>;
      payload: JsonValue;
      guards: NonNullable<MutationCommand['guards']>;
      handler: (input: MutationEnvelope) => MutationCommand['handler'];
    }
  | { kind: 'existing'; data: Record<string, JsonValue> };

/**
 * A one-step write (spec 009 R1): the resolver reads the target and its revisions inside the
 * same immediate transaction as the guarded write, then the strict guards and handler run
 * unchanged. The strict path (`executeMutation`) is untouched. A fresh operation identifier is
 * generated; repeat safety comes from the resolver seeing the effect already present (R2).
 */
export function executeShortcut(options: {
  context: CoreContext;
  operation: string;
  projectSlug: string;
  resolve: (transaction: DatabaseTransaction) => Resolution;
}) {
  const { context } = options;
  try {
    return context.connection.db.transaction(
      (transaction) => {
        const state = currentState(transaction);
        const resolution = options.resolve(transaction);
        if (resolution.kind === 'existing')
          return successEnvelopeSchema.parse({
            ok: true,
            data: { ...resolution.data, existing: true },
            meta: {
              database_epoch: state.databaseEpoch,
              timezone: state.timezone,
              now: formatTimestamp(context.now()),
              read_revision: state.readRevision,
            },
          });
        const input: MutationEnvelope = {
          operation_id: randomUUID(),
          database_epoch: state.databaseEpoch,
          ...resolution.tokens,
          payload: resolution.payload,
        };
        const command: MutationCommand = {
          context,
          operation: options.operation,
          projectSlug: options.projectSlug,
          input,
          guards: resolution.guards,
          handler: resolution.handler(input),
        };
        const parsed = parseCommand(command);
        return commitMutation(transaction, command, parsed, hashCommand(command, parsed));
      },
      { behavior: 'immediate' },
    );
  } catch (error) {
    throw lockFailure(error);
  }
}
