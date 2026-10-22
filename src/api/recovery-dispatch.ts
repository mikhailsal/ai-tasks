import { createContext } from '../core/context.js';
import type { DatabaseConnection } from '../core/database/types.js';
import { acceptRestore } from '../core/recovery/service.js';
import { createBackup, listBackups, validateBackup } from '../core/recovery/index.js';
import { createReadContext } from '../core/context.js';
import {
  backupEnvelopeSchema,
  backupListEnvelopeSchema,
  backupValidationEnvelopeSchema,
} from '../schema/recovery.js';
import { restoreAcceptanceEnvelopeSchema, type HelperCommand } from './helper-protocol.js';

type RecoveryCommand = Extract<HelperCommand, { operation: `backup.${string}` }>;

/** Caller identity comes from the private transport, never a supplied actor string. */
export async function dispatchRecovery(
  connection: DatabaseConnection,
  command: RecoveryCommand,
  options: { backupDirectory?: string } = {},
) {
  const directoryOption =
    options.backupDirectory === undefined ? {} : { backupDirectory: options.backupDirectory };
  if (command.operation === 'backup.list') {
    const result = await listBackups(
      createReadContext({ connection }),
      command.input,
      directoryOption,
    );
    return backupListEnvelopeSchema.parse(result);
  }
  if (command.operation === 'backup.validate') {
    const result = await validateBackup(
      createReadContext({ connection }),
      command.backup_id,
      directoryOption,
    );
    return backupValidationEnvelopeSchema.parse(result);
  }
  if (command.operation === 'backup.create') {
    const context = createContext({ connection, actor: 'human-web' });
    return backupEnvelopeSchema.parse(
      await createBackup(context, command.scope.project_slug, command.input, directoryOption),
    );
  }
  const slug = command.scope.project_slug;
  const context = createContext({
    connection,
    actor: command.caller === 'web' ? 'human-web' : `ai-cli:${slug}`,
  });
  const accepted = await acceptRestore(context, slug, command.input, options);
  return restoreAcceptanceEnvelopeSchema.parse({
    ok: true,
    meta: accepted.record.result.meta,
    data: { receipt: accepted.record.result, published: accepted.published },
  });
}
