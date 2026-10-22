import { expect, it } from 'vitest';
import { z } from 'zod/mini';
import {
  DomainError,
  cliExit,
  domainError,
  errorEnvelope,
  httpStatus,
  normalizeError,
} from '../../src/core/errors.js';
import { errorCodeSchema, errorDefinitions } from '../../src/schema/errors.js';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';
import { DatabaseLockError } from '../../src/runtime/database-lock.js';
it('normalizes malformed diagnostic path labels while preserving legitimate Unicode paths', () => {
  const malformed = String.fromCharCode(0xd800);
  const valid = '原文 👩🏽‍💻';
  const validation = new z.core.$ZodError([
    { code: 'custom', path: [valid, 0, malformed], message: 'Private input' },
  ]);
  expect(() => normalizeError(validation)).not.toThrow();
  expect(() => errorEnvelope(validation)).not.toThrow();
  const envelope = errorEnvelope(validation);
  expect(envelope).toMatchObject({
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      details: { issues: [{ code: 'custom', path: [valid, 0, '�'] }] },
    },
  });
  expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
  expect(JSON.stringify(envelope)).not.toContain('\\ud800');
});
it('distinguishes an HTTP route miss from invalid application input', () => {
  expect(httpStatus('ROUTE_NOT_FOUND')).toBe(404);
  expect(httpStatus('VALIDATION_ERROR')).toBe(400);
});
it.each([
  ['VALIDATION_ERROR', 400, 2, false],
  ['TASK_NOT_FOUND', 404, 3, false],
  ['PROJECT_NOT_FOUND', 404, 3, false],
  ['PROJECT_MISMATCH', 409, 4, false],
  ['DB_CONFLICT', 409, 4, true],
  ['REVISION_CONFLICT', 409, 4, false],
  ['CONFIG_CONFLICT', 409, 4, false],
  ['CURSOR_STALE', 409, 4, false],
  ['DEPENDENCY_BLOCKED', 409, 4, false],
  ['EMOJI_CONFLICT', 409, 4, false],
  ['CONFIRMATION_REQUIRED', 409, 4, false],
  ['IDEMPOTENCY_CONFLICT', 409, 4, false],
  ['DATABASE_EPOCH_CONFLICT', 409, 4, false],
  ['MAINTENANCE', 503, 5, true],
  ['ORIGIN_REJECTED', 403, 1, false],
  ['ROUTE_NOT_FOUND', 404, 1, false],
  ['INTERNAL_ERROR', 500, 1, false],
] as const)(
  'maps %s to the contracted transport status and retry policy',
  (code, status, exit, retryable) => {
    const error = domainError(code, 'Safe public diagnostic');
    expect(httpStatus(error)).toBe(status);
    expect(cliExit(error)).toBe(exit);
    expect(httpStatus(code)).toBe(status);
    expect(cliExit(code)).toBe(exit);
    expect(error.retryable).toBe(retryable);
    expect(errorDefinitions[code]).toMatchObject({ httpStatus: status, cliExit: exit, retryable });
  },
);
it('retains authored structured domain details without serializing stacks or private Error fields', () => {
  const details = { entity_id: 'safe-id', expected_revision: 3, current_revision: 4 };
  const error = domainError('REVISION_CONFLICT', 'Task changed since it was read', details);
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(DomainError);
  expect(normalizeError(error)).toBe(error);
  const envelope = errorEnvelope(error);
  expect(envelope).toEqual({
    ok: false,
    error: {
      code: 'REVISION_CONFLICT',
      message: 'Task changed since it was read',
      details,
      retryable: false,
    },
  });
  expect(errorEnvelopeSchema.parse(envelope)).toEqual(envelope);
  expect(JSON.stringify(envelope)).not.toContain('stack');
});
it('exposes only path and issue code from Zod failures, excluding input and custom messages', () => {
  const secret =
    'private-task-description /home/private/application.sqlite SELECT password FROM secrets';
  const parsed = z
    .object({
      tasks: z.array(z.object({ title: z.string().check(z.refine(() => false, secret)) })),
    })
    .safeParse({ tasks: [{ title: secret }] });
  if (parsed.success) throw new Error('Expected a validation fixture error');
  expect(errorEnvelope(parsed.error)).toEqual({
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: errorDefinitions.VALIDATION_ERROR.message,
      retryable: false,
      details: { issues: [{ code: 'custom', path: ['tasks', 0, 'title'] }] },
    },
  });
  expect(JSON.stringify(errorEnvelope(parsed.error))).not.toContain(secret);
});
it.each([
  'SQLITE_BUSY',
  'SQLITE_BUSY_SNAPSHOT',
  'SQLITE_BUSY_RECOVERY',
  'SQLITE_LOCKED',
  'SQLITE_LOCKED_SHAREDCACHE',
])('translates %s into retryable DB_CONFLICT without native diagnostics', (code) => {
  const native = Object.assign(new Error('database is locked: /home/private/application.sqlite'), {
    code,
  });
  expect(errorEnvelope(native)).toEqual({
    ok: false,
    error: {
      code: 'DB_CONFLICT',
      message: errorDefinitions.DB_CONFLICT.message,
      details: null,
      retryable: true,
    },
  });
});
it.each(['DB_CONFLICT', 'VALIDATION_ERROR', 'INTERNAL_ERROR'] as const)(
  'normalizes the actual runtime DatabaseLockError %s without leaking its raw message',
  (code) => {
    const error = new DatabaseLockError(code, 'Private path /home/private/application.sqlite');
    expect(normalizeError(error)).toMatchObject({
      code,
      message: errorDefinitions[code].message,
      details: null,
    });
    expect(JSON.stringify(errorEnvelope(error))).not.toContain('/home/private');
  },
);
it('normalizes the operational recovery code with fixed safe maintenance details', () => {
  const error = Object.assign(new Error('/home/private/application.sqlite.recovery.json'), {
    code: 'MAINTENANCE',
    details: { private: 'secret' },
  });
  expect(errorEnvelope(error)).toEqual({
    ok: false,
    error: {
      code: 'MAINTENANCE',
      message: errorDefinitions.MAINTENANCE.message,
      details: null,
      retryable: true,
    },
  });
});
it.each([
  undefined,
  null,
  'private thrown text',
  42,
  new Error('SELECT private FROM credentials at /home/private/application.sqlite'),
  Object.assign(new Error('private constraint payload'), { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }),
  Object.assign(new Error('private retry lookalike'), { code: 'SQLITE_BUSYNESS' }),
  Object.assign(new Error('private domain lookalike'), { code: 'PROJECT_MISMATCH' }),
  { code: 'MAINTENANCE', message: 'caller-selected error' },
])('replaces unexpected failures with the safe internal envelope (%#)', (error) => {
  expect(errorEnvelope(error)).toEqual({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: errorDefinitions.INTERNAL_ERROR.message,
      details: null,
      retryable: false,
    },
  });
  expect(httpStatus(error)).toBe(500);
  expect(cliExit(error)).toBe(1);
});
it('keeps the browser-safe registry complete and rejects unknown or misleading codes', () => {
  expect(Object.keys(errorDefinitions).sort()).toEqual([...errorCodeSchema.options].sort());
  for (const value of [
    '',
    'SQLITE_BUSY',
    'MAINTENANCE\0PRIVATE',
    'revision_conflict',
    { code: 'DB_CONFLICT' },
  ]) {
    expect(errorCodeSchema.safeParse(value).success).toBe(false);
  }
});
