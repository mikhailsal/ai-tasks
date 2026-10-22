import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { link, rm } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { backupCreateInputSchema, backupEnvelopeSchema } from '../../schema/recovery.js';
import type { CoreContext } from '../database/types.js';
import { domainError, normalizeError } from '../errors.js';
import { formatTimestamp } from '../time.js';
import { parseInput } from '../validation.js';
import {
  backupDirectory,
  managedPath,
  recoveryCollection,
  syncDirectory,
  syncFile,
} from './files.js';
import { recoveryMutation, guardRecoveryMutation, type RecoveryReadContext } from './guards.js';
import { describeSnapshot, finalizeSnapshot } from './snapshot.js';
import {
  backupSnapshotPath,
  findOperationalReceipt,
  publishOperationalReceipt,
  writeBackupManifest,
} from './manifests.js';
import { listManagedBackups } from './catalog.js';

export type BackupOptions = { backupDirectory?: string };
const backupDeadlineMs = 30_000;
async function copyOnline(context: RecoveryReadContext, temporary: string) {
  const deadline = performance.now() + backupDeadlineMs;
  await context.connection.sqlite.backup(temporary, {
    progress() {
      if (performance.now() >= deadline)
        throw domainError('DB_CONFLICT', 'The online backup could not finish within its deadline');
      return 128;
    },
  });
  if (performance.now() >= deadline)
    throw domainError('DB_CONFLICT', 'The online backup could not finish within its deadline');
  finalizeSnapshot(temporary);
  await syncFile(temporary);
}
/** Domain tables, revisions, audit and SQLite receipts remain untouched. */
export async function createBackup(
  context: CoreContext,
  projectSlug: string,
  envelope: MutationEnvelope,
  options: BackupOptions = {},
) {
  try {
    const request = recoveryMutation(context, projectSlug, envelope, 'backup.create');
    const directory = backupDirectory(context.connection.sqlite.name, options.backupDirectory);
    const existing = await findOperationalReceipt({
      backupDirectory: directory,
      identity: request.identity,
    });
    if (existing) return backupEnvelopeSchema.parse(existing.result);
    guardRecoveryMutation(context, request.project, request.input);
    parseInput(backupCreateInputSchema, request.input.payload);
    return await createManagedBackup(context, directory, request);
  } catch (error) {
    throw normalizeError(error);
  }
}
async function createManagedBackup(
  context: CoreContext,
  directory: string,
  request: ReturnType<typeof recoveryMutation>,
) {
  const collection = await recoveryCollection(directory, 'snapshots', true);
  const id = randomUUID();
  const temporary = join(collection, `.${id}.sqlite.partial`);
  const path = backupSnapshotPath({ backupDirectory: directory, backupId: id });
  let published = false;
  try {
    await copyOnline(context, temporary);
    const now = context.now();
    const { info, state } = await describeSnapshot(temporary, {
      id,
      createdAt: formatTimestamp(now),
    });
    guardRecoveryMutation(context, request.project, request.input);
    const result = backupEnvelopeSchema.parse({
      ok: true,
      data: info,
      meta: {
        database_epoch: state.database_epoch,
        timezone: state.timezone,
        now: formatTimestamp(now),
        read_revision: state.read_revision,
        operation_id: request.input.operation_id,
        audit_ids: [],
      },
    });
    await link(temporary, path);
    await rm(temporary);
    await syncDirectory(collection);
    const record = { version: 1 as const, identity: request.identity, result };
    await writeBackupManifest(directory, record);
    // Once receipt publication begins, an fsync error may follow a visible winning
    // link. Preserve its verified artifact; an unreferenced attempt stays unlisted.
    published = true;
    const outcome = await publishOperationalReceipt(directory, record);
    published = outcome.published;
    return backupEnvelopeSchema.parse(outcome.record.result);
  } finally {
    await rm(temporary, { force: true });
    if (!published) {
      await rm(path, { force: true });
      await rm(managedPath(directory, 'snapshots', id), { force: true });
    }
  }
}
export async function listBackups(
  context: RecoveryReadContext,
  input: unknown,
  options: BackupOptions = {},
) {
  try {
    return await listManagedBackups(
      context,
      input,
      backupDirectory(context.connection.sqlite.name, options.backupDirectory),
    );
  } catch (error) {
    throw normalizeError(error);
  }
}
