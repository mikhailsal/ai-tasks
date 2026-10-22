import { expect, it } from 'vitest';
import { dispatchRecovery } from '../../src/api/recovery-dispatch.js';
import {
  helperCommandSchema,
  restoreAcceptanceEnvelopeSchema,
} from '../../src/api/helper-protocol.js';
import { createBackup } from '../../src/core/recovery/backup.js';
import { validateBackup } from '../../src/core/recovery/validation.js';
import { readRecoveryJob } from '../../src/core/recovery/manifests.js';
import {
  createRecoveryFixture,
  seedRecoveryProject,
  makeRestoreEnvelope,
} from '../fixtures/recovery.js';

it.each(['web', 'cli'] as const)(
  'accepts a real restore as the fixed %s identity without domain writes',
  async (caller) => {
    const fixture = await createRecoveryFixture();
    try {
      await seedRecoveryProject(fixture, 'alpha', '🧭');
      const options = { backupDirectory: fixture.backupDirectory };
      const backup = await createBackup(
        fixture.context,
        'alpha',
        {
          ...fixture.mutation({}),
          expected_settings_revision: 1,
        },
        options,
      );
      const validation = await validateBackup(fixture.context, backup.data.id, options);
      const command = helperCommandSchema.parse({
        operation: 'backup.restore.accept',
        scope: { project_slug: 'alpha' },
        caller,
        input: makeRestoreEnvelope(fixture, {
          backupId: backup.data.id,
          affectedProjects: validation.data.affected_projects,
        }),
      });
      if (command.operation !== 'backup.restore.accept')
        throw new Error('Incorrect fixture command');
      const snapshot = () => fixture.connection.sqlite.serialize();
      const before = snapshot();
      const original = JSON.stringify(command);
      const accepted = restoreAcceptanceEnvelopeSchema.parse(
        await dispatchRecovery(fixture.context.connection, command, options),
      );
      expect(accepted.data.published).toBe(true);
      expect(accepted.data.receipt.data.state).toBe('queued');
      expect(accepted.meta).toEqual(accepted.data.receipt.meta);
      const stored = await readRecoveryJob({
        backupDirectory: fixture.backupDirectory,
        jobId: accepted.data.receipt.data.job_id,
      });
      expect(stored.identity.actor).toBe(caller === 'web' ? 'human-web' : 'ai-cli:alpha');
      expect(stored.identity.project_slug).toBe('alpha');
      const replay = await dispatchRecovery(fixture.context.connection, command, options);
      expect(replay.data).toEqual({ receipt: accepted.data.receipt, published: false });
      expect(snapshot()).toEqual(before);
      expect(JSON.stringify(command)).toBe(original);
      await expect(
        dispatchRecovery(
          fixture.context.connection,
          {
            ...command,
            caller: caller === 'web' ? 'cli' : 'web',
          },
          options,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    } finally {
      await fixture.close();
    }
  },
);
