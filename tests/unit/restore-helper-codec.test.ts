import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  decodeRestoreCommand,
  decodeRestoreMessage,
  decodeRestoreRequest,
} from '../../src/core/recovery/command.js';

function restore() {
  return {
    operation: 'restore',
    databasePath: '/tmp/live.sqlite',
    projectSlug: 'alpha',
    actor: 'human-web',
    jobId: randomUUID(),
    envelope: {
      operation_id: randomUUID(),
      database_epoch: randomUUID(),
      expected_config_revision: 2,
      expected_settings_revision: 3,
      payload: { backup_id: randomUUID(), confirmation: { asserted: true, user_text: 'Вернуть' } },
    },
  };
}

it('round trips the accepted job identity, exact consent and original revision tokens', () => {
  const command = restore();
  const wire = { type: 'request', id: randomUUID(), command };
  expect(decodeRestoreRequest(JSON.parse(JSON.stringify(wire)))).toEqual(wire);
  expect(decodeRestoreCommand({ ...command, actor: 'ai-cli:alpha' })).toEqual({
    ...command,
    actor: 'ai-cli:alpha',
  });
});

it.each(['now', 'failpoint', 'timeoutSeconds', 'lock', 'signal'])(
  'rejects private injection %s before execution',
  (key) => {
    expect(() => decodeRestoreCommand({ ...restore(), [key]: 1 })).toThrow();
  },
);

it('rejects forged actors, unknown operations, malformed paths and non-UUID jobs', () => {
  const command = restore();
  for (const invalid of [
    { ...command, actor: 'ai-cli:beta' },
    { ...command, actor: 'recurrence-worker' },
    { ...command, operation: 'sql' },
    { ...command, jobId: '../other' },
    { ...command, databasePath: '' },
    { ...command, databasePath: '/tmp/a\0b' },
    { operation: 'recover', databasePath: '/tmp/live.sqlite', actor: 'human-web' },
  ])
    expect(() => decodeRestoreCommand(invalid)).toThrow();
});

it('rejects own unknown __proto__ command/envelope keys without losing legitimate payload keys', () => {
  const command = restore();
  const unknown = JSON.parse('{"__proto__":"hidden"}');
  expect(() => decodeRestoreCommand({ ...command, ...unknown })).toThrow();
  expect(() =>
    decodeRestoreRequest({
      type: 'request',
      id: randomUUID(),
      command: { ...command, ...unknown },
    }),
  ).toThrow();
  expect(() =>
    decodeRestoreCommand({ ...command, envelope: { ...command.envelope, ...unknown } }),
  ).toThrow();
  const payload = JSON.parse('{"__proto__":{"source":"kept"},"constructor":1}');
  const parsed = decodeRestoreCommand({ ...command, envelope: { ...command.envelope, payload } });
  expect(parsed.operation).toBe('restore');
  if (parsed.operation === 'restore')
    expect(JSON.stringify(parsed.envelope.payload)).toBe(JSON.stringify(payload));
});

it('recovery allows only the canonical command fields and an optional active UUID', () => {
  const command = {
    operation: 'recover',
    databasePath: '/tmp/live.sqlite',
    backupDirectory: '/tmp/backups',
    activeJobId: randomUUID(),
  };
  expect(decodeRestoreCommand(command)).toEqual(command);
  expect(decodeRestoreRequest({ type: 'shutdown' })).toEqual({ type: 'shutdown' });
  expect(() => decodeRestoreRequest({ type: 'shutdown', command })).toThrow();
});

it('validates protocol version, correlation IDs, complete results and safe error codes', () => {
  const id = randomUUID();
  const result = {
    database_epoch: randomUUID(),
    affected_projects: ['alpha'],
    audit_ids: [randomUUID()],
    recovery_snapshot_id: randomUUID(),
  };
  expect(decodeRestoreMessage({ type: 'ready', version: 1 })).toEqual({
    type: 'ready',
    version: 1,
  });
  expect(decodeRestoreMessage({ type: 'result', id, result })).toEqual({
    type: 'result',
    id,
    result,
  });
  expect(decodeRestoreMessage({ type: 'result', id, result: null })).toEqual({
    type: 'result',
    id,
    result: null,
  });
  expect(() =>
    decodeRestoreMessage({
      type: 'result',
      id,
      result: { ...result, ...JSON.parse('{"__proto__":1}') },
    }),
  ).toThrow();
  for (const invalid of [
    { type: 'ready', version: 2 },
    { type: 'result', id: 'wrong', result },
    { type: 'result', id, result: {} },
    {
      type: 'failure',
      id,
      error: {
        ok: false,
        error: { code: 'ARBITRARY', message: 'unsafe', details: null, retryable: true },
      },
    },
  ])
    expect(() => decodeRestoreMessage(invalid)).toThrow();
});
