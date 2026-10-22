import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { errorEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import {
  backupInfo,
  backupValidation,
  recoveryJob,
  successfulRecovery,
  waitRecoveryJob,
} from '../fixtures/recovery-transport.js';
import {
  installRecoveryContracts,
  valid,
  failure,
} from '../fixtures/recovery-registrations-context.js';
const { current, createCall, restoreCall, backup } = installRecoveryContracts();
it('valid HTTP backup creation succeeds after migrated metadata control [US6 behavioral RED]', async () => {
  const control = await current().request('http', {
    command: ['meta'],
    path: '/meta?all_projects=true',
  });
  expect(control.status).toBe(200);
  expect(metaEnvelopeSchema.parse(control.envelope).data.database_epoch).toBe(current().epoch);
  const before = current().snapshot();
  const result = await current().request('http', createCall());
  expect(result.status, JSON.stringify(result.envelope)).toBe(201);
  expect(backupInfo.parse(successfulRecovery(result)).database_epoch).toBe(current().epoch);
  expect(current().snapshot()).toEqual(before);
});
it('validation and restore cover current-only scope and refuse incomplete or stale union claims', async () => {
  const info = await backup();
  // Production commands create the live-only project after the snapshot.
  const added = await current().request('http', {
    command: [],
    path: '/projects/beta',
    method: 'POST',
    input: {
      operation_id: randomUUID(),
      database_epoch: current().epoch,
      payload: { slug: 'beta', name: 'После снимка', emoji: '🪺' },
    },
  });
  expect(added.status).toBe(201);
  const validation = backupValidation.parse(
    valid(
      await current().request('http', {
        command: [],
        path: `/backups/${info.id}/validate`,
        method: 'POST',
        input: { all_projects: true },
      }),
      'http',
    ),
  );
  expect(validation.affected_projects).toEqual([
    { project_slug: 'alpha', expected_revision: 1, expected_config_revision: 1 },
    { project_slug: 'beta', expected_revision: 1, expected_config_revision: 1 },
  ]);
  const omitted = await current().request('http', restoreCall(info.id));
  expect(omitted.envelope.ok).toBe(false);
  const before = current().snapshot();
  const staleOtherProject = await current().request(
    'http',
    restoreCall(info.id, {
      affected_projects: [
        { project_slug: 'alpha', expected_revision: 1, expected_config_revision: 1 },
        { project_slug: 'beta', expected_revision: 2, expected_config_revision: 1 },
      ],
    }),
  );
  failure(staleOtherProject, 'http', 'REVISION_CONFLICT');
  expect(current().snapshot()).toEqual(before);
  const call = restoreCall(info.id, { affected_projects: validation.affected_projects });
  const accepted = recoveryJob.parse(valid(await current().request('http', call), 'http', 202));
  const done = await waitRecoveryJob(current(), accepted.job_id);
  expect(done.result?.affected_projects).toEqual(['alpha', 'beta']);
  expect(
    current().inspect((sqlite) => sqlite.prepare('SELECT slug FROM projects ORDER BY slug').all()),
  ).toEqual([{ slug: 'alpha' }]);
  expect(
    successEnvelopeSchema.parse(
      (await current().request('http', { command: [], path: '/meta?all_projects=true' })).envelope,
    ).meta.database_epoch,
  ).toBe(done.result?.database_epoch);
});

it('backup-only union claims use null revisions and restore adds the missing project', async () => {
  const info = await backup();
  const added = await current().request('http', {
    command: [],
    path: '/projects/beta',
    method: 'POST',
    input: {
      operation_id: randomUUID(),
      database_epoch: current().epoch,
      payload: { slug: 'beta', name: 'После снимка', emoji: '🪺' },
    },
  });
  expect(added.status).toBe(201);
  const newer = await backup();
  const firstRestore = recoveryJob.parse(
    valid(
      await current().request(
        'http',
        restoreCall(info.id, {
          affected_projects: [
            { project_slug: 'alpha', expected_revision: 1, expected_config_revision: 1 },
            { project_slug: 'beta', expected_revision: 1, expected_config_revision: 1 },
          ],
        }),
      ),
      'http',
      202,
    ),
  );
  const firstDone = await waitRecoveryJob(current(), firstRestore.job_id);
  expect(firstDone.state).toBe('succeeded');
  const backupOnly = backupValidation.parse(
    valid(
      await current().request('http', {
        command: [],
        path: `/backups/${newer.id}/validate`,
        method: 'POST',
        input: { all_projects: true },
      }),
      'http',
    ),
  );
  expect(backupOnly.affected_projects).toEqual([
    { project_slug: 'alpha', expected_revision: 1, expected_config_revision: 1 },
    { project_slug: 'beta', expected_revision: null, expected_config_revision: null },
  ]);
  const restoreBackupOnly = restoreCall(newer.id, {
    affected_projects: backupOnly.affected_projects,
  });
  const recovered = recoveryJob.parse(
    valid(
      await current().request('http', {
        ...restoreBackupOnly,
        input: {
          ...restoreBackupOnly.input,
          database_epoch: firstDone.result?.database_epoch ?? '',
        },
      }),
      'http',
      202,
    ),
  );
  expect((await waitRecoveryJob(current(), recovered.job_id)).state).toBe('succeeded');
  expect(
    current().inspect((sqlite) => sqlite.prepare('SELECT slug FROM projects ORDER BY slug').all()),
  ).toEqual([{ slug: 'alpha' }, { slug: 'beta' }]);
});

it('an archived attribution scope permits operational backup without unarchiving or changing domain state', async () => {
  const archived = await current().request('http', {
    command: [],
    path: '/projects/alpha/archive',
    method: 'POST',
    project: 'alpha',
    input: current().envelope(
      { affected_tasks: [{ task_id: current().taskId, expected_revision: 1 }] },
      { expected_revision: 1 },
    ),
  });
  expect(archived.status).toBe(200);
  const before = current().snapshot();
  const info = await backup();
  expect(info.projects).toEqual([{ project_slug: 'alpha', revision: 2, config_revision: 1 }]);
  expect(current().snapshot()).toEqual(before);
});
it('the supervisor serves job status by both IDs while ordinary database reads report maintenance', async () => {
  const info = await backup();
  const held = acquireDatabaseLock({ databasePath: current().path, mode: 'shared' });
  let jobId: string;
  try {
    const call = restoreCall(info.id);
    const accepted = recoveryJob.parse(valid(await current().request('http', call), 'http', 202));
    jobId = accepted.job_id;
    const byOperation = await current().request('http', {
      command: [],
      path: `/backups/jobs?all_projects=true&operation_id=${accepted.operation_id}`,
    });
    expect(recoveryJob.parse(valid(byOperation, 'http')).job_id).toBe(jobId);
    expect(
      recoveryJob.parse(
        valid(
          await current().request('http', {
            command: [],
            path: `/backups/jobs/${jobId}?all_projects=true`,
          }),
          'http',
        ),
      ).operation_id,
    ).toBe(accepted.operation_id);
    const metadata = await current().request('http', {
      command: [],
      path: '/meta?all_projects=true',
    });
    expect(metadata.status).toBe(503);
    expect(errorEnvelopeSchema.parse(metadata.envelope).error.code).toBe('MAINTENANCE');
  } finally {
    releaseDatabaseLock(held);
  }
  expect((await waitRecoveryJob(current(), jobId)).state).toBe('succeeded');
});
