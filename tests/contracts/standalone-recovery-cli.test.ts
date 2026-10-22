import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { z } from 'zod/mini';
import { acceptRestore } from '../../src/core/recovery/service.js';
import { getRecoveryStatus } from '../../src/core/recovery/status.js';
import {
  backupEnvelopeSchema,
  backupListEnvelopeSchema,
  backupValidationEnvelopeSchema,
  recoveryJobEnvelopeSchema,
  restoreInputSchema,
} from '../../src/schema/recovery.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { prepareRecoveryScenario } from '../fixtures/recovery-scenario.js';
import {
  proveRecoveryUnlocked,
  standaloneRecoveryCli,
  standaloneRecoveryInventory,
  waitStandaloneRecovery,
} from '../fixtures/standalone-recovery-cli.js';

it('standalone restore waits for terminal success, uses CLI identity and releases every shared/exclusive descriptor', async () => {
  const scenario = await prepareRecoveryScenario();
  const { fixture } = scenario;
  try {
    const result = await standaloneRecoveryCli(
      fixture,
      ['backup', 'restore', '--project', 'alpha'],
      scenario.request.envelope,
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe('');
    const receipt = recoveryJobEnvelopeSchema.parse(result.envelope);
    expect(receipt.data.state).toBe('succeeded');
    expect(receipt.data.finished_at).not.toBeNull();
    expect(receipt.data.result?.database_epoch).not.toBe(scenario.oldEpoch);
    expect(receipt.meta.database_epoch).toBe(receipt.data.result?.database_epoch);
    proveRecoveryUnlocked(fixture);
    fixture.reopen();
    expect(fixture.epoch()).toBe(receipt.data.result?.database_epoch);
    expect(
      fixture.connection.sqlite.prepare('SELECT id,title FROM tasks ORDER BY id').all(),
    ).toEqual([{ id: scenario.originalId, title: 'Работа из снимка' }]);
    const events = fixture.connection.sqlite
      .prepare(
        "SELECT actor,origin,confirmation FROM audit_records WHERE action='database.restore' AND operation_id=?",
      )
      .all(scenario.request.envelope.operation_id);
    expect(
      z
        .array(z.strictObject({ actor: z.string(), origin: z.string(), confirmation: z.string() }))
        .parse(events),
    ).toEqual([
      {
        actor: 'ai-cli:alpha',
        origin: 'cli',
        confirmation: JSON.stringify({ asserted: true, user_text: 'Подтверждаю восстановление' }),
      },
    ]);
  } finally {
    await fixture.close();
  }
});

it('standalone old-epoch exact retry conflicts rather than restoring twice', async () => {
  const { fixture, request, oldEpoch } = await prepareRecoveryScenario();
  try {
    const first = await standaloneRecoveryCli(
      fixture,
      ['backup', 'restore', '--project', 'alpha'],
      request.envelope,
    );
    expect(first.code, first.stderr).toBe(0);
    const receipt = recoveryJobEnvelopeSchema.parse(first.envelope);
    const repeated = await standaloneRecoveryCli(
      fixture,
      ['backup', 'restore', '--project', 'alpha'],
      request.envelope,
    );
    expect(repeated.code).toBe(4);
    expect(repeated.stdout).toBe('');
    expect(repeated.envelope).toMatchObject({
      ok: false,
      error: { code: 'DATABASE_EPOCH_CONFLICT' },
    });
    proveRecoveryUnlocked(fixture);
    fixture.reopen();
    expect(fixture.epoch()).not.toBe(oldEpoch);
    expect(fixture.epoch()).toBe(receipt.data.result?.database_epoch);
    expect(
      fixture.connection.sqlite
        .prepare("SELECT COUNT(*) AS count FROM audit_records WHERE action='database.restore'")
        .get(),
    ).toEqual({ count: 1 });
  } finally {
    await fixture.close();
  }
});

it('standalone status by job and operation reads only external manifests while the DB lock is exclusive', async () => {
  const { fixture, request } = await prepareRecoveryScenario();
  try {
    fixture.reopen();
    const accepted = await acceptRestore(fixture.context, 'alpha', request.envelope, {
      backupDirectory: fixture.backupDirectory,
    });
    fixture.closeDatabaseForRestore();
    const lock = acquireDatabaseLock({
      databasePath: fixture.databasePath,
      mode: 'exclusive',
      timeoutSeconds: 0,
    });
    try {
      for (const args of [
        ['backup', 'status', accepted.record.result.data.job_id, '--all-projects'],
        ['backup', 'status', '--operation-id', request.envelope.operation_id, '--all-projects'],
      ]) {
        const result = await standaloneRecoveryCli(fixture, args);
        expect(result.code, result.stderr).toBe(0);
        expect(result.stderr).toBe('');
        expect(recoveryJobEnvelopeSchema.parse(result.envelope).data).toEqual(
          accepted.record.result.data,
        );
      }
    } finally {
      releaseDatabaseLock(lock);
    }
  } finally {
    await fixture.close();
  }
});

it('standalone backup list is an all-projects pure read without an API supervisor', async () => {
  const { fixture, backupId } = await prepareRecoveryScenario();
  try {
    fixture.reopen();
    const before = fixture.connection.sqlite.serialize();
    fixture.closeDatabaseForRestore();
    const inventory = await standaloneRecoveryInventory(fixture);
    const listed = await standaloneRecoveryCli(fixture, ['backup', 'list', '--all-projects']);
    expect(listed.code, listed.stderr).toBe(0);
    expect(
      backupListEnvelopeSchema.parse(listed.envelope).data.items.map((item) => item.id),
    ).toEqual([backupId]);
    expect(await standaloneRecoveryInventory(fixture)).toEqual(inventory);
    fixture.reopen();
    expect(fixture.connection.sqlite.serialize()).toEqual(before);
  } finally {
    await fixture.close();
  }
});

it('standalone backup validation is an all-projects pure read with the exact project union', async () => {
  const { fixture, backupId, request } = await prepareRecoveryScenario();
  try {
    fixture.reopen();
    const before = fixture.connection.sqlite.serialize();
    fixture.closeDatabaseForRestore();
    const inventory = await standaloneRecoveryInventory(fixture);
    const validated = await standaloneRecoveryCli(fixture, [
      'backup',
      'validate',
      backupId,
      '--all-projects',
    ]);
    expect(validated.code, validated.stderr).toBe(0);
    expect(backupValidationEnvelopeSchema.parse(validated.envelope).data).toMatchObject({
      compatible: true,
      integrity: 'ok',
      affected_projects: restoreInputSchema.parse(request.envelope.payload).affected_projects,
    });
    expect(await standaloneRecoveryInventory(fixture)).toEqual(inventory);
    fixture.reopen();
    expect(fixture.connection.sqlite.serialize()).toEqual(before);
  } finally {
    await fixture.close();
  }
});

it('standalone backup creation replays its external receipt exactly without domain writes', async () => {
  const { fixture, request } = await prepareRecoveryScenario();
  try {
    fixture.reopen();
    const before = fixture.connection.sqlite.serialize();
    fixture.closeDatabaseForRestore();
    const input = { ...request.envelope, operation_id: randomUUID(), payload: {} };
    const first = await standaloneRecoveryCli(
      fixture,
      ['backup', 'create', '--project', 'alpha'],
      input,
    );
    expect(first.code, first.stderr).toBe(0);
    const replay = await standaloneRecoveryCli(
      fixture,
      ['backup', 'create', '--project', 'alpha'],
      input,
    );
    expect(replay.code, replay.stderr).toBe(0);
    expect(backupEnvelopeSchema.parse(replay.envelope)).toEqual(
      backupEnvelopeSchema.parse(first.envelope),
    );
    fixture.reopen();
    expect(fixture.connection.sqlite.serialize()).toEqual(before);
  } finally {
    await fixture.close();
  }
});

it('standalone no-wait returns durable acceptance before an external shared holder allows publication', async () => {
  const { fixture, request, oldEpoch } = await prepareRecoveryScenario();
  let jobId: string | undefined;
  const blocker = acquireDatabaseLock({
    databasePath: fixture.databasePath,
    mode: 'shared',
    timeoutSeconds: 0,
  });
  let released = false;
  try {
    const result = await standaloneRecoveryCli(
      fixture,
      ['backup', 'restore', '--project', 'alpha', '--no-wait'],
      request.envelope,
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    const accepted = recoveryJobEnvelopeSchema.parse(result.envelope);
    jobId = accepted.data.job_id;
    expect(['queued', 'running']).toContain(accepted.data.state);
    expect(accepted.data.result).toBeNull();
    fixture.reopen();
    expect(fixture.epoch()).toBe(oldEpoch);
    expect(fixture.connection.sqlite.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({
      count: 2,
    });
    fixture.closeDatabaseForRestore();
    const pending = await getRecoveryStatus({
      backupDirectory: fixture.backupDirectory,
      operationId: request.envelope.operation_id,
    });
    expect(pending.data).toMatchObject({ job_id: jobId, result: null });
    expect(['queued', 'running']).toContain(pending.data.state);
    releaseDatabaseLock(blocker);
    released = true;
    const terminal = await waitStandaloneRecovery(fixture, jobId);
    expect(terminal.data.state).toBe('succeeded');
    const status = await standaloneRecoveryCli(fixture, [
      'backup',
      'status',
      '--operation-id',
      request.envelope.operation_id,
      '--all-projects',
    ]);
    expect(status.code, status.stderr).toBe(0);
    expect(recoveryJobEnvelopeSchema.parse(status.envelope).data).toEqual(terminal.data);
    proveRecoveryUnlocked(fixture);
    fixture.reopen();
    expect(fixture.epoch()).not.toBe(oldEpoch);
  } finally {
    fixture.closeDatabaseForRestore();
    if (!released) releaseDatabaseLock(blocker);
    try {
      if (jobId) await waitStandaloneRecovery(fixture, jobId);
    } finally {
      await fixture.close();
    }
  }
});
