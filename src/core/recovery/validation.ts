import { backupValidationEnvelopeSchema } from '../../schema/recovery.js';
import { uuidSchema } from '../../schema/values.js';
import { normalizeError } from '../errors.js';
import { parseInput } from '../validation.js';
import { backupDirectory } from './files.js';
import { recoveryRead, type RecoveryReadContext } from './guards.js';
import { backupSnapshotPath, readBackupManifest } from './manifests.js';
import { verifiedSnapshot, snapshotMetadata } from './snapshot.js';
import { assertRecoveryReservations } from './reservations.js';
import { assertNoDivergentAuditIds, assertReadableAuditRecords } from './history.js';
import type { BackupOptions } from './backup.js';

export async function validateBackup(
  context: RecoveryReadContext,
  backupId: string,
  options: BackupOptions = {},
) {
  try {
    const id = parseInput(uuidSchema, backupId);
    const directory = backupDirectory(context.connection.sqlite.name, options.backupDirectory);
    const manifest = await readBackupManifest(directory, id);
    const sqlite = await verifiedSnapshot(
      backupSnapshotPath({ backupDirectory: directory, backupId: id }),
      manifest.result.data,
    );
    try {
      return context.connection.db.transaction(() => {
        const current = recoveryRead(context);
        assertReadableAuditRecords(context.connection.sqlite);
        assertReadableAuditRecords(sqlite);
        assertRecoveryReservations(context.connection.sqlite, sqlite);
        assertNoDivergentAuditIds(context.connection.sqlite, sqlite);
        const live = new Map(
          snapshotMetadata(context.connection.sqlite).projects.map((project) => [
            project.project_slug,
            project,
          ]),
        );
        const union = new Set([
          ...live.keys(),
          ...manifest.result.data.projects.map((project) => project.project_slug),
        ]);
        const affected = [...union].sort().map((slug) => ({
          project_slug: slug,
          expected_revision: live.get(slug)?.revision ?? null,
          expected_config_revision: live.get(slug)?.config_revision ?? null,
        }));
        return backupValidationEnvelopeSchema.parse({
          ok: true,
          meta: current.meta,
          data: {
            backup: manifest.result.data,
            compatible: true,
            integrity: 'ok',
            affected_projects: affected,
          },
        });
      });
    } finally {
      sqlite.close();
    }
  } catch (error) {
    throw normalizeError(error);
  }
}
