import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import {
  backupInfo,
  backupPage,
  backupValidation,
  recoveryJob,
  waitRecoveryJob,
  type RecoveryTransport,
} from './recovery-transport.js';
import { valid, failure, type RecoveryContracts } from './recovery-registrations-context.js';

export function registerRecoveryTransportContracts(
  transport: RecoveryTransport,
  context: RecoveryContracts,
) {
  const { current, createCall, backup } = context;
  describe(`${transport} recovery transport`, () => {
    it('requires exactly one status lookup key and all-projects read scope', async () => {
      const id = randomUUID();
      const operation = randomUUID();
      for (const call of [
        { command: ['backup', 'status'], path: '/backups/jobs?all_projects=true' },
        {
          command: ['backup', 'status', id, '--operation-id', operation],
          path: `/backups/jobs/${id}?all_projects=true&operation_id=${operation}`,
        },
        {
          command: ['backup', 'status', '--operation-id', 'not-a-uuid'],
          path: '/backups/jobs?all_projects=true&operation_id=not-a-uuid',
        },
        { command: ['backup', 'status', id], path: `/backups/jobs/${id}`, scope: false },
      ])
        failure(await current().request(transport, call), transport, 'VALIDATION_ERROR', 400);
    });
    it('pages opaque backup IDs in stable descending creation order and rejects an oversized limit', async () => {
      const first = await backup(transport);
      const second = await backup(transport);
      const before = current().snapshot();
      const page = backupPage.parse(
        valid(
          await current().request(transport, {
            command: ['backup', 'list', '--limit', '1'],
            path: '/backups?all_projects=true&limit=1',
          }),
          transport,
        ),
      );
      expect(page.items).toHaveLength(1);
      expect(page.next_cursor).not.toBeNull();
      const cursor = page.next_cursor ?? '';
      const next = backupPage.parse(
        valid(
          await current().request(transport, {
            command: ['backup', 'list', '--limit', '1', '--cursor', cursor],
            path: `/backups?all_projects=true&limit=1&cursor=${encodeURIComponent(cursor)}`,
          }),
          transport,
        ),
      );
      const expected = [first, second].sort(
        (left, right) =>
          right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id),
      );
      expect([...page.items, ...next.items]).toEqual(expected);
      expect(next.next_cursor).toBeNull();
      failure(
        await current().request(transport, {
          command: ['backup', 'list', '--limit', '201'],
          path: '/backups?all_projects=true&limit=201',
        }),
        transport,
        'VALIDATION_ERROR',
        400,
      );
      expect(current().snapshot()).toEqual(before);
    });
    it('creates an opaque managed manifest, exact replay and pure list/validation without domain receipts', async () => {
      const before = current().snapshot();
      const call = createCall();
      const created = await current().request(transport, call);
      const info = backupInfo.parse(valid(created, transport, 201));
      expect(successEnvelopeSchema.parse(created.envelope).meta).toMatchObject({
        operation_id: call.input.operation_id,
        audit_ids: [],
      });
      expect(info).toMatchObject({
        database_epoch: current().epoch,
        settings_revision: 1,
        projects: [{ project_slug: 'alpha', revision: 1, config_revision: 1 }],
      });
      expect(await current().request(transport, call)).toEqual(created);
      const listed = valid(
        await current().request(transport, {
          command: ['backup', 'list'],
          path: '/backups?all_projects=true',
        }),
        transport,
      );
      expect(backupPage.parse(listed)).toEqual({ items: [info], next_cursor: null });
      const validation = backupValidation.parse(
        valid(
          await current().request(transport, {
            command: ['backup', 'validate', info.id],
            path: `/backups/${info.id}/validate`,
            method: 'POST',
            ...(transport === 'http' ? { input: { all_projects: true } } : {}),
          }),
          transport,
        ),
      );
      expect(validation.affected_projects).toEqual([
        { project_slug: 'alpha', expected_revision: 1, expected_config_revision: 1 },
      ]);
      expect(current().snapshot()).toEqual(before);
      expect(JSON.stringify(created.envelope)).not.toContain(current().directory);
    });
    it('rejects changed operation payload, stale settings/config/epoch without a domain write', async () => {
      const call = createCall();
      await backup(transport);
      const first = await current().request(transport, call);
      valid(first, transport, 201);
      const before = current().snapshot();
      for (const [patch, code] of [
        [{ expected_config_revision: 2 }, 'IDEMPOTENCY_CONFLICT'],
        [{ operation_id: randomUUID(), expected_settings_revision: 2 }, 'CONFIG_CONFLICT'],
        [{ operation_id: randomUUID(), expected_config_revision: 2 }, 'CONFIG_CONFLICT'],
        [{ operation_id: randomUUID(), database_epoch: randomUUID() }, 'DATABASE_EPOCH_CONFLICT'],
      ] as const) {
        failure(
          await current().request(transport, { ...call, input: { ...call.input, ...patch } }),
          transport,
          code,
        );
      }
      expect(current().snapshot()).toEqual(before);
    });
  });
}

export function registerRestoreTransportContracts(
  transport: RecoveryTransport,
  context: RecoveryContracts,
) {
  const { current, createCall, restoreCall, backup } = context;
  describe(`${transport} restore validation and status`, () => {
    it.each([
      ['missing confirmation', { confirmation: undefined }],
      ['unasserted confirmation', { confirmation: { asserted: false, user_text: 'Нет согласия' } }],
      ['empty confirmation text', { confirmation: { asserted: true, user_text: '' } }],
    ] as const)('restore rejects %s without publishing or changing epoch', async (_name, patch) => {
      const info = await backup();
      const call = restoreCall(info.id);
      const payload = {
        backup_id: info.id,
        affected_projects: [
          { project_slug: 'alpha', expected_revision: 1, expected_config_revision: 1 },
        ],
        ...(patch.confirmation === undefined ? {} : { confirmation: patch.confirmation }),
      };
      const before = current().snapshot();
      const result = await current().request(transport, {
        ...call,
        input: current().envelope(payload),
      });
      expect(result.envelope.ok).toBe(false);
      expect(errorEnvelopeSchema.parse(result.envelope).error.code).toMatch(
        /^(CONFIRMATION_REQUIRED|VALIDATION_ERROR)$/u,
      );
      expect(current().snapshot()).toEqual(before);
    });
    it.each([
      ['omitted', []],
      [
        'stale entity',
        [{ project_slug: 'alpha', expected_revision: 2, expected_config_revision: 1 }],
      ],
      [
        'stale config',
        [{ project_slug: 'alpha', expected_revision: 1, expected_config_revision: 2 }],
      ],
      [
        'foreign extra',
        [
          { project_slug: 'alpha', expected_revision: 1, expected_config_revision: 1 },
          { project_slug: 'foreign', expected_revision: null, expected_config_revision: null },
        ],
      ],
      [
        'duplicate',
        [
          { project_slug: 'alpha', expected_revision: 1, expected_config_revision: 1 },
          { project_slug: 'alpha', expected_revision: 1, expected_config_revision: 1 },
        ],
      ],
      [
        'null live',
        [{ project_slug: 'alpha', expected_revision: null, expected_config_revision: null }],
      ],
    ])('restore refuses %s affected-project claim atomically', async (_name, affected) => {
      const info = await backup();
      const before = current().snapshot();
      const result = await current().request(
        transport,
        restoreCall(info.id, { affected_projects: affected }),
      );
      expect(result.envelope.ok).toBe(false);
      expect(errorEnvelopeSchema.parse(result.envelope).error.code).toMatch(
        /^(VALIDATION_ERROR|REVISION_CONFLICT|CONFIG_CONFLICT)$/u,
      );
      expect(current().snapshot()).toEqual(before);
    });
    it('restores once, exposes durable job and lost-response operation lookup, then rejects exact old-epoch retry', async () => {
      const info = await backup();
      const call = restoreCall(info.id);
      const accepted = recoveryJob.parse(
        valid(await current().request(transport, call), transport, 202),
      );
      if (transport === 'cli') expect(accepted.state).toBe('succeeded');
      expect(accepted.operation_id).toBe(call.input.operation_id);
      const complete = await waitRecoveryJob(current(), accepted.job_id);
      expect(complete.state).toBe('succeeded');
      expect(complete.error).toBeNull();
      expect(complete.result?.database_epoch).not.toBe(current().epoch);
      expect(complete.result?.affected_projects).toEqual(['alpha']);
      expect(complete.result?.audit_ids.length).toBeGreaterThan(0);
      const restoredAudit = current().inspect((sqlite) =>
        sqlite
          .prepare(
            'SELECT actor,project_slug,confirmation FROM audit_records WHERE operation_id=? ORDER BY id',
          )
          .all(accepted.operation_id),
      );
      expect(restoredAudit).toEqual([
        {
          actor: transport === 'cli' ? 'ai-cli:alpha' : 'human-web',
          project_slug: 'alpha',
          confirmation: JSON.stringify({
            asserted: true,
            user_text: 'Восстановить весь снимок, сохранив историю.',
          }),
        },
      ]);
      await current().restart();
      const byId = recoveryJob.parse(
        valid(
          await current().request(transport, {
            command: ['backup', 'status', accepted.job_id],
            path: `/backups/jobs/${accepted.job_id}?all_projects=true`,
          }),
          transport,
        ),
      );
      const byOperation = recoveryJob.parse(
        valid(
          await current().request(transport, {
            command: ['backup', 'status', '--operation-id', accepted.operation_id],
            path: `/backups/jobs?all_projects=true&operation_id=${accepted.operation_id}`,
          }),
          transport,
        ),
      );
      expect(byOperation).toEqual(byId);
      expect(byId).toEqual(complete);
      const before = current().snapshot();
      failure(await current().request(transport, call), transport, 'DATABASE_EPOCH_CONFLICT');
      expect(current().snapshot()).toEqual(before);
    });
    it('refuses filesystem paths, missing scope and actor injection at the actual boundary', async () => {
      const before = current().snapshot();
      const invalid = await current().request(transport, {
        command: ['backup', 'validate', '../outside.sqlite'],
        path: '/backups/..%2Foutside.sqlite/validate',
        method: 'POST',
        input: { all_projects: true },
      });
      expect(invalid.envelope.ok).toBe(false);
      expect(JSON.stringify(invalid.envelope)).not.toContain(current().directory);
      const actor = await current().request(
        transport,
        createCall(current().envelope({ actor: 'human-web', path: '/tmp/arbitrary.sqlite' })),
      );
      failure(actor, transport, 'VALIDATION_ERROR', 400);
      const missing = await current().request(transport, {
        command: ['backup', 'list'],
        path: '/backups',
        scope: false,
      });
      failure(missing, transport, 'VALIDATION_ERROR', 400);
      expect(current().snapshot()).toEqual(before);
    });
  });
}
