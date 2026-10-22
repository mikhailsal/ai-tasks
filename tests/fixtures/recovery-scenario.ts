import { z } from 'zod/mini';
import {
  createRecoveryFixture,
  loadRecoveryApi,
  makeRestoreEnvelope,
  seedRecoveryProject,
  seedRecoveryTask,
} from './recovery.js';

/** A verified snapshot and a newer live branch, with all shared handles released. */
export async function prepareRecoveryScenario() {
  const fixture = await createRecoveryFixture();
  try {
    await seedRecoveryProject(fixture, 'alpha', '🧭');
    const original = z.object({ data: z.object({ id: z.uuid() }) }).parse(
      await seedRecoveryTask(fixture, {
        projectSlug: 'alpha',
        title: 'Работа из снимка',
        emoji: '📌',
      }),
    );
    const api = await loadRecoveryApi();
    const backup = await api.createBackup(
      fixture.context,
      'alpha',
      { ...fixture.mutation({}), expected_settings_revision: 1 },
      { backupDirectory: fixture.backupDirectory },
    );
    await seedRecoveryTask(fixture, {
      projectSlug: 'alpha',
      title: 'Работа после снимка',
      emoji: '🪁',
    });
    const validation = await api.validateBackup(fixture.context, backup.data.id, {
      backupDirectory: fixture.backupDirectory,
    });
    const oldEpoch = fixture.epoch();
    const envelope = makeRestoreEnvelope(fixture, {
      backupId: backup.data.id,
      affectedProjects: validation.data.affected_projects,
    });
    const request = {
      action: 'restore' as const,
      databasePath: fixture.databasePath,
      backupDirectory: fixture.backupDirectory,
      projectSlug: 'alpha',
      envelope,
      actor: fixture.actor,
      now: fixture.clock.now(),
    };
    fixture.closeDatabaseForRestore();
    return { fixture, request, oldEpoch, originalId: original.data.id, backupId: backup.data.id };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
