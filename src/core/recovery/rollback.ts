import { constants } from 'node:fs';
import { copyFile, lstat, open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { ConnectionLock } from '../database/lock-check.js';
import { fileChecksum, missingFile, syncDirectory, syncFile } from './files.js';
import { assertReadableAuditRecords } from './history.js';
import { backupSnapshotPath, readBackupManifest } from './manifests.js';
import { recoveryMaintenance, type RecoveryPhase } from './phase.js';
import type { RecoveryFailpoint } from './prepare.js';
import { finalizeSnapshot, openSnapshot, snapshotMetadata, verifiedSnapshot } from './snapshot.js';
import { inspectRecoveryLive } from './verify-live.js';

type RollbackOptions = {
  databasePath: string;
  lock: ConnectionLock;
  backupDirectory: string;
  phase: RecoveryPhase;
  now: () => number;
  failpoint?: RecoveryFailpoint;
};
/** A phase is never trusted without independently verifying its durable old generation. */
export async function verifyRecoveryCopy(directory: string, phase: RecoveryPhase): Promise<void> {
  try {
    const manifest = await readBackupManifest(directory, phase.old_backup.id);
    if (JSON.stringify(manifest.result.data) !== JSON.stringify(phase.old_backup))
      throw recoveryMaintenance();
    if (
      manifest.result.meta.database_epoch !== phase.previous_meta.database_epoch ||
      manifest.result.meta.read_revision !== phase.previous_meta.read_revision ||
      manifest.result.meta.timezone !== phase.previous_meta.timezone
    )
      throw recoveryMaintenance();
    const sqlite = await verifiedSnapshot(
      backupSnapshotPath({ backupDirectory: directory, backupId: phase.old_backup.id }),
      phase.old_backup,
    );
    try {
      const state = snapshotMetadata(sqlite).state;
      if (
        state.read_revision !== phase.previous_meta.read_revision ||
        state.timezone !== phase.previous_meta.timezone
      )
        throw recoveryMaintenance();
      assertReadableAuditRecords(sqlite);
    } finally {
      sqlite.close();
    }
  } catch {
    throw recoveryMaintenance();
  }
}
export async function refuseUnexpectedWal(path: string): Promise<void> {
  try {
    const wal = await lstat(`${path}-wal`);
    if (!wal.isFile() || wal.isSymbolicLink() || wal.size !== 0) throw recoveryMaintenance();
  } catch (error) {
    if (!missingFile(error)) throw recoveryMaintenance();
  }
}
async function preserveDamagedBytes(path: string, jobId: string): Promise<void> {
  let checksum: string;
  try {
    checksum = await fileChecksum(path);
  } catch (error) {
    if (missingFile(error)) return;
    throw recoveryMaintenance();
  }
  const artifact = `${path}.damaged-${jobId}-${randomUUID()}.sqlite`;
  // This is closed damaged-byte evidence, not a database backup or a live/WAL copy.
  await copyFile(path, artifact, constants.COPYFILE_EXCL);
  await syncFile(artifact);
  if ((await fileChecksum(artifact)) !== checksum || (await fileChecksum(path)) !== checksum)
    throw recoveryMaintenance();
  await syncDirectory(dirname(path));
}
async function copyVerifiedOld(options: RollbackOptions, target: string): Promise<void> {
  const handle = await open(
    target,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  await handle.close();
  const sqlite = await verifiedSnapshot(
    backupSnapshotPath({
      backupDirectory: options.backupDirectory,
      backupId: options.phase.old_backup.id,
    }),
    options.phase.old_backup,
  );
  try {
    await sqlite.backup(target);
  } finally {
    sqlite.close();
  }
  finalizeSnapshot(target);
  const copied = await openSnapshot(target);
  try {
    const metadata = snapshotMetadata(copied);
    if (
      metadata.state.database_epoch !== options.phase.old_backup.database_epoch ||
      metadata.state.read_revision !== options.phase.previous_meta.read_revision ||
      metadata.state.timezone !== options.phase.previous_meta.timezone ||
      metadata.state.revision !== options.phase.old_backup.settings_revision ||
      JSON.stringify(metadata.projects) !== JSON.stringify(options.phase.old_backup.projects)
    )
      throw recoveryMaintenance();
    assertReadableAuditRecords(copied);
  } finally {
    copied.close();
  }
  await syncFile(target);
}
/** Restore from SQLite's verified backup API; the live pathname is never unlinked. */
export async function rollbackPublished(options: RollbackOptions): Promise<void> {
  await refuseUnexpectedWal(options.databasePath);
  await preserveDamagedBytes(options.databasePath, options.phase.job_id);
  const temporary = `${options.databasePath}.rollback-${options.phase.job_id}-${randomUUID()}.sqlite`;
  try {
    await copyVerifiedOld(options, temporary);
    await options.failpoint?.('recovery.before_replace');
    // No SQLite handle remains open across this atomic replacement.
    await rename(temporary, options.databasePath);
    await options.failpoint?.('recovery.after_replace');
    await syncDirectory(dirname(options.databasePath));
    const old = inspectRecoveryLive(options);
    if (old.state !== 'old') throw recoveryMaintenance();
  } finally {
    await rm(temporary, { force: true });
  }
}
