import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createHelperDrain } from '../../src/api/data-helper.js';
import { helperMessageSchema } from '../../src/api/helper-protocol.js';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';

const result = successEnvelopeSchema.parse({
  ok: true,
  data: { finished: true },
  meta: {
    database_epoch: randomUUID(),
    timezone: 'UTC',
    now: '2026-10-22T00:00:00.000Z',
  },
});
function request() {
  return { type: 'request', id: randomUUID(), operation: 'meta', scope: { all_projects: true } };
}

it('stops accepting immediately and drains actual work after a caller stops awaiting it', async () => {
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const messages: unknown[] = [];
  let calls = 0;
  const drain = createHelperDrain({
    async dispatch() {
      calls += 1;
      entered.resolve();
      await gate.promise;
      return result;
    },
    send: (message) => messages.push(message),
  });
  const accepted = request();
  drain.receive(accepted);
  await entered.promise;
  let closed = false;
  const closing = drain.stop().then(() => {
    closed = true;
  });
  const rejected = request();
  drain.receive(rejected);
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(calls).toBe(1);
  expect(messages.map((message) => helperMessageSchema.parse(message))).toMatchObject([
    { type: 'response', id: rejected.id, envelope: { ok: false, error: { code: 'MAINTENANCE' } } },
  ]);
  gate.resolve();
  await closing;
  expect(messages.map((message) => helperMessageSchema.parse(message))).toMatchObject([
    { id: rejected.id },
    { type: 'response', id: accepted.id, envelope: result },
  ]);
});

it('shutdown waits for every accepted request and safely reports async rejection', async () => {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const messages: unknown[] = [];
  let calls = 0;
  const drain = createHelperDrain({
    async dispatch() {
      calls += 1;
      const call = calls;
      if (call === 1) await first.promise;
      else await second.promise;
      if (call === 2) throw new Error('/private/database.sqlite SELECT secret');
      return result;
    },
    send: (message) => messages.push(message),
  });
  drain.receive(request());
  drain.receive(request());
  drain.receive({ type: 'shutdown' });
  let closed = false;
  void drain.drained.then(() => {
    closed = true;
  });
  first.resolve();
  await Promise.resolve();
  expect(closed).toBe(false);
  second.resolve();
  await drain.drained;
  expect(messages).toHaveLength(2);
  expect(JSON.stringify(messages)).not.toMatch(/private|SELECT secret/u);
  expect(messages.map((message) => helperMessageSchema.parse(message))).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ envelope: expect.objectContaining({ ok: false }) }),
    ]),
  );
});

it('rejects untrusted restore caller and actor properties before dispatch', async () => {
  let calls = 0;
  const messages: unknown[] = [];
  const drain = createHelperDrain({
    dispatch() {
      calls += 1;
      return result;
    },
    send: (message) => messages.push(message),
  });
  drain.receive({
    ...request(),
    operation: 'backup.restore.accept',
    scope: { project_slug: 'alpha' },
    caller: 'cli',
    actor: 'human-web',
    input: { operation_id: randomUUID(), database_epoch: randomUUID(), payload: {} },
  });
  await drain.stop();
  expect(calls).toBe(0);
  expect(helperMessageSchema.parse(messages[0])).toMatchObject({
    type: 'response',
    envelope: { ok: false, error: { code: 'VALIDATION_ERROR' } },
  });
});
