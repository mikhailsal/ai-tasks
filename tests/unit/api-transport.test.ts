import { randomUUID } from 'node:crypto';
import fastify from 'fastify';
import { expect, it } from 'vitest';
import { dispatch } from '../../src/api/dispatch.js';
import { registerStrictJsonParser } from '../../src/api/json-parser.js';
import { errorEnvelope, httpStatus } from '../../src/core/errors.js';
import { helperCommandSchema } from '../../src/api/helper-protocol.js';
import {
  emptyQuery,
  queryInput,
  queryScope,
  taskQueryKeys,
} from '../../src/api/routes/transport.js';
import { createOrdinaryFixture, ordinarySnapshot } from '../fixtures/ordinary-work.js';

it('decodes typed wire filters while preserving Unicode text, canonical status_id and null priority', () => {
  expect(
    queryInput(
      {
        project_slug: 'alpha',
        limit: '20',
        include_terminal: 'false',
        q: 'План 👩🏽‍💻',
        status_id: 'ready',
        priority: 'null',
      },
      taskQueryKeys,
    ),
  ).toEqual({
    project_slug: 'alpha',
    limit: 20,
    include_terminal: false,
    q: 'План 👩🏽‍💻',
    status_id: 'ready',
    priority: null,
  });
  expect(
    queryInput(
      { all_projects: 'true', priority: '{"model":"numeric","value":1.125}' },
      taskQueryKeys,
    ),
  ).toEqual({ all_projects: true, priority: { model: 'numeric', value: 1.125 } });
});

it.each([
  JSON.parse('{"__proto__":"x"}'),
  { all_projects: ['true', 'false'] },
  { status: 'ready' },
  { include_terminal: 'yes' },
  { limit: '1.5' },
  { priority: '{broken' },
  { unexpected: 'x' },
])('rejects original unknown, duplicated or malformed query fields %j', (input) => {
  expect(() => queryInput(input, taskQueryKeys)).toThrow();
});

it('rejects own special query keys before reconstruction and conflicting explicit scope', () => {
  expect(() => emptyQuery(JSON.parse('{"__proto__":"x"}'))).toThrow();
  expect(() => queryScope({ project_slug: 'alpha', all_projects: 'true' })).toThrow();
  expect(() => queryScope({})).toThrow();
});

it('preserves unknown special helper query fields until authoritative core validation rejects them', async () => {
  const fixture = await createOrdinaryFixture();
  try {
    const command = helperCommandSchema.parse({
      operation: 'project.list',
      input: JSON.parse('{"all_projects":true,"__proto__":"x"}'),
    });
    if (command.operation !== 'project.list') throw new Error('Unexpected fixture command');
    expect(Object.hasOwn(command.input, '__proto__')).toBe(true);
    const before = ordinarySnapshot(fixture);
    expect(() => dispatch(fixture.human, command)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(ordinarySnapshot(fixture)).toEqual(before);
  } finally {
    await fixture.close();
  }
});

it('defers mutation payload validation until after the epoch guard and replays before state pre-reads', async () => {
  const fixture = await createOrdinaryFixture();
  try {
    const invalid = helperCommandSchema.parse({
      operation: 'project.create',
      scope: { project_slug: 'alpha' },
      input: {
        operation_id: randomUUID(),
        database_epoch: randomUUID(),
        payload: { config: 'invalid' },
      },
    });
    const before = ordinarySnapshot(fixture);
    expect(() => dispatch(fixture.human, invalid)).toThrow(
      expect.objectContaining({ code: 'DATABASE_EPOCH_CONFLICT' }),
    );
    expect(ordinarySnapshot(fixture)).toEqual(before);
    const command = helperCommandSchema.parse({
      operation: 'project.create',
      scope: { project_slug: 'alpha' },
      input: {
        operation_id: randomUUID(),
        database_epoch: fixture.epoch,
        payload: { slug: 'alpha', name: 'Альфа', emoji: '🚀' },
      },
    });
    const first = dispatch(fixture.human, command);
    fixture.connection.sqlite
      .prepare("UPDATE projects SET config_revision=2,archived_at=1 WHERE slug='alpha'")
      .run();
    const committed = ordinarySnapshot(fixture);
    expect(dispatch(fixture.human, command)).toEqual(first);
    expect(ordinarySnapshot(fixture)).toEqual(committed);
  } finally {
    await fixture.close();
  }
});

it('rejects malformed UTF-8 JSON bytes before a route can accept rewritten source', async () => {
  const app = fastify();
  registerStrictJsonParser(app);
  app.setErrorHandler((error, _request, reply) =>
    reply.code(httpStatus(error)).send(errorEnvelope(error)),
  );
  app.post('/source', async (request) => request.body);
  try {
    const payload = Buffer.concat([
      Buffer.from('{"description":"'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}'),
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/source',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const source = '  План � 👩🏽‍💻\r\n';
    const valid = await app.inject({
      method: 'POST',
      url: '/source',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ description: source }),
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ description: source });
    const poisoned = await app.inject({
      method: 'POST',
      url: '/source',
      headers: { 'content-type': 'application/json' },
      payload: '{"__proto__":{"polluted":true}}',
    });
    expect(poisoned.statusCode).toBeGreaterThanOrEqual(400);
  } finally {
    await app.close();
  }
});
