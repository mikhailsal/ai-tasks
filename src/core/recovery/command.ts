import { z } from 'zod/mini';
import { mutationEnvelopeSchema, errorEnvelopeSchema } from '../../schema/envelopes.js';
import { errorCodeSchema } from '../../schema/errors.js';
import { restoreResultSchema } from '../../schema/recovery.js';
import type { recoveryJobEnvelopeSchema } from '../../schema/recovery.js';
import { jsonValueSchema, slugSchema, uuidSchema } from '../../schema/values.js';
import { actorSchema } from '../context.js';
import type { ConnectionLock } from '../database/lock-check.js';
import { domainError } from '../errors.js';
import { parseInput } from '../validation.js';
import { backupDirectory } from './files.js';

const pathSchema = z.string().check(
  z.minLength(1),
  z.refine((value) => !value.includes('\0')),
);
const restoreCommandSchema = z.strictObject({
  operation: z.literal('restore'),
  databasePath: pathSchema,
  backupDirectory: z.optional(pathSchema),
  projectSlug: slugSchema,
  envelope: mutationEnvelopeSchema,
  actor: actorSchema,
  jobId: z.optional(uuidSchema),
});
const recoverCommandSchema = z.strictObject({
  operation: z.literal('recover'),
  databasePath: pathSchema,
  backupDirectory: z.optional(pathSchema),
  activeJobId: z.optional(uuidSchema),
});
const commandSchema = z.discriminatedUnion('operation', [
  restoreCommandSchema,
  recoverCommandSchema,
]);
const requestSchema = z.strictObject({
  type: z.literal('request'),
  id: uuidSchema,
  command: commandSchema,
});
const shutdownSchema = z.strictObject({ type: z.literal('shutdown') });
const failureSchema = z.extend(errorEnvelopeSchema, {
  error: z.extend(errorEnvelopeSchema.shape.error, { code: errorCodeSchema }),
});
const messageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready'), version: z.literal(1) }),
  z.strictObject({
    type: z.literal('result'),
    id: uuidSchema,
    result: z.nullable(restoreResultSchema),
  }),
  z.strictObject({ type: z.literal('failure'), id: uuidSchema, error: failureSchema }),
]);
export type RestoreHelperCommand = z.infer<typeof commandSchema>;
export type RestoreHelperRequest = z.infer<typeof requestSchema>;
export type RestoreHelperMessage = z.infer<typeof messageSchema>;
export type RecoveryJobEnvelope = z.infer<typeof recoveryJobEnvelopeSchema>;
export type { RestoreResult } from '../../schema/recovery.js';

function ownKeys(value: unknown, allowed: readonly string[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw domainError('VALIDATION_ERROR', 'Invalid private recovery command');
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw domainError('VALIDATION_ERROR', 'Unknown private recovery command field');
}

export function decodeRestoreCommand(value: unknown): RestoreHelperCommand {
  const json = parseInput(jsonValueSchema, value);
  ownKeys(json, [
    'operation',
    'databasePath',
    'backupDirectory',
    'projectSlug',
    'envelope',
    'actor',
    'jobId',
    'activeJobId',
  ]);
  if (json !== null && typeof json === 'object' && !Array.isArray(json) && 'envelope' in json)
    ownKeys(json.envelope, [
      'operation_id',
      'database_epoch',
      'expected_revision',
      'expected_config_revision',
      'expected_settings_revision',
      'payload',
    ]);
  const command = parseInput(commandSchema, json);
  if (
    command.operation === 'restore' &&
    command.actor !== 'human-web' &&
    command.actor !== `ai-cli:${command.projectSlug}`
  )
    throw domainError('VALIDATION_ERROR', 'Recovery actor must match attribution scope');
  return command;
}

export function decodeRestoreRequest(value: unknown) {
  const json = parseInput(jsonValueSchema, value);
  ownKeys(value, ['type', 'id', 'command']);
  if (json !== null && typeof json === 'object' && !Array.isArray(json) && 'command' in json)
    decodeRestoreCommand(json.command);
  const request = parseInput(z.union([requestSchema, shutdownSchema]), value);
  if (request.type === 'shutdown') return request;
  return { ...request, command: decodeRestoreCommand(request.command) };
}

export function decodeRestoreMessage(value: unknown): RestoreHelperMessage {
  const json = parseInput(jsonValueSchema, value);
  rejectProtocolProto(json);
  ownKeys(value, ['type', 'version', 'id', 'result', 'error']);
  return parseInput(messageSchema, value);
}

export function rejectProtocolProto(value: z.infer<typeof jsonValueSchema>): void {
  if (value === null || typeof value !== 'object') return;
  for (const [key, field] of Object.entries(value)) {
    if (key === '__proto__')
      throw domainError('VALIDATION_ERROR', 'Unknown private recovery response field');
    // Public diagnostic details remain arbitrary, faithfully preserved JSON.
    if (key !== 'details') rejectProtocolProto(field);
  }
}

/** The runtime owns the actual exclusive descriptor; production inputs expose no test hooks. */
export async function dispatchRestoreCommand(command: RestoreHelperCommand, lock: ConnectionLock) {
  const input = decodeRestoreCommand(command);
  const directory = backupDirectory(lock.databasePath, input.backupDirectory);
  if (input.operation === 'restore') {
    // Only the exclusive child invokes this port; decoding in its supervisor
    // must not load the native SQLite implementation.
    const { runRestore } = await import('./service.js');
    return parseInput(
      restoreResultSchema,
      await runRestore({
        databasePath: lock.databasePath,
        backupDirectory: directory,
        projectSlug: input.projectSlug,
        actor: input.actor,
        envelope: input.envelope,
        ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
        lock,
      }),
    );
  }
  const { recoverDatabase } = await import('./recover.js');
  await recoverDatabase({
    databasePath: lock.databasePath,
    backupDirectory: directory,
    ...(input.activeJobId === undefined ? {} : { activeJobId: input.activeJobId }),
    lock,
  });
  return null;
}
