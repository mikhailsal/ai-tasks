import { z } from 'zod/mini';
import { errorEnvelopeSchema } from '../../schema/envelopes.js';
import { errorCodeSchema } from '../../schema/errors.js';
import { recoveryJobEnvelopeSchema } from '../../schema/recovery.js';
import { jsonValueSchema } from '../../schema/values.js';
import { createContext } from '../context.js';
import type { ConnectionLock } from '../database/lock-check.js';
import { domainError } from '../errors.js';
import { parseInput } from '../validation.js';
import { decodeRestoreCommand, rejectProtocolProto, type RestoreHelperCommand } from './command.js';

const ownerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready'), version: z.literal(1) }),
  z.strictObject({ type: z.literal('accepted'), receipt: recoveryJobEnvelopeSchema }),
  z.strictObject({
    type: z.literal('failure'),
    error: z.extend(errorEnvelopeSchema, {
      error: z.extend(errorEnvelopeSchema.shape.error, { code: errorCodeSchema }),
    }),
  }),
]);
export type RecoveryOwnerMessage = z.output<typeof ownerMessageSchema>;
export function decodeRecoveryOwnerMessage(value: unknown): RecoveryOwnerMessage {
  const json = parseInput(jsonValueSchema, value);
  rejectProtocolProto(json);
  if (
    json === null ||
    typeof json !== 'object' ||
    Array.isArray(json) ||
    Object.keys(json).some((key) => !['type', 'version', 'receipt', 'error'].includes(key))
  )
    throw domainError('VALIDATION_ERROR', 'Invalid recovery owner message');
  return parseInput(ownerMessageSchema, json);
}
export function decodeStandaloneCommand(value: unknown) {
  const command = decodeRestoreCommand(value);
  if (
    command.operation !== 'restore' ||
    command.actor !== `ai-cli:${command.projectSlug}` ||
    command.jobId !== undefined
  )
    throw domainError(
      'VALIDATION_ERROR',
      'Standalone recovery requires its original CLI attribution',
    );
  return command;
}
/** Acceptance owns no connection after return; runtime can next request an exclusive helper. */
export async function acceptStandaloneRestore(command: RestoreHelperCommand, lock: ConnectionLock) {
  const input = decodeStandaloneCommand(command);
  const [{ openDatabase }, { acceptRestore }] = await Promise.all([
    import('../database/open.js'),
    import('./service.js'),
  ]);
  const connection = openDatabase({ path: lock.databasePath, lock });
  try {
    const accepted = await acceptRestore(
      createContext({ connection, actor: input.actor }),
      input.projectSlug,
      input.envelope,
      input.backupDirectory === undefined ? {} : { backupDirectory: input.backupDirectory },
    );
    return { receipt: accepted.record.result, published: accepted.published };
  } finally {
    connection.close();
  }
}
