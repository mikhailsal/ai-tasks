import { afterEach, beforeEach, expect } from 'vitest';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';
import type { JsonValue } from '../../src/schema/values.js';
import {
  backupInfo,
  createRecoveryHarness,
  successfulRecovery,
  type RecoveryHarness,
  type RecoveryTransport,
} from './recovery-transport.js';
export function valid(
  response: Awaited<ReturnType<RecoveryHarness['request']>>,
  transport: RecoveryTransport,
  status = 200,
) {
  expect(response.status, JSON.stringify(response.envelope)).toBe(transport === 'cli' ? 0 : status);
  return successfulRecovery(response);
}
export function failure(
  response: Awaited<ReturnType<RecoveryHarness['request']>>,
  transport: RecoveryTransport,
  code: string,
  status = 409,
) {
  expect(response.status, JSON.stringify(response.envelope)).toBe(
    transport === 'cli' ? (status === 400 ? 2 : 4) : status,
  );
  expect(errorEnvelopeSchema.parse(response.envelope).error.code).toBe(code);
}

export function installRecoveryContracts() {
  let harness: RecoveryHarness;
  beforeEach(async () => {
    harness = await createRecoveryHarness();
  });
  afterEach(async () => {
    await harness?.close();
  });
  function createCall(input = harness.envelope()) {
    return {
      command: ['backup', 'create'],
      path: '/projects/alpha/backups',
      method: 'POST' as const,
      project: 'alpha',
      input,
    };
  }
  function restoreCall(backupId: string, overrides: Record<string, JsonValue> = {}) {
    return {
      command: ['backup', 'restore'],
      path: '/projects/alpha/backups/restore',
      method: 'POST' as const,
      project: 'alpha',
      input: harness.envelope({
        backup_id: backupId,
        affected_projects: [
          { project_slug: 'alpha', expected_revision: 1, expected_config_revision: 1 },
        ],
        confirmation: { asserted: true, user_text: 'Восстановить весь снимок, сохранив историю.' },
        ...overrides,
      }),
    };
  }
  async function backup(transport: RecoveryTransport = 'http') {
    return backupInfo.parse(valid(await harness.request(transport, createCall()), transport, 201));
  }
  return { current: () => harness, createCall, restoreCall, backup };
}
export type RecoveryContracts = ReturnType<typeof installRecoveryContracts>;
