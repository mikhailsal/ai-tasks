import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createUs2Harness } from '../fixtures/us2-contract.js';

const host = '127.0.0.1:3000';
let harness: Awaited<ReturnType<typeof createUs2Harness>>;
beforeAll(async () => {
  harness = await createUs2Harness();
});
afterAll(async () => {
  await harness.close();
});

async function send(method: 'GET' | 'POST', url: string, payload?: unknown) {
  const response = await harness.app.inject({
    method,
    url,
    headers: {
      host,
      origin: `http://${host}`,
      'content-type': 'application/json',
      'x-ai-tasks-mutation': '1',
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

it('a read without scope names project_slug and all_projects=true', async () => {
  const { status, body } = await send('GET', '/api/v1/meta');
  expect(status).toBe(400);
  expect(body).toMatchObject({
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Choose a read scope: project_slug or all_projects=true',
      details: {
        issues: expect.any(Array),
        hints: [{ action: 'choose_scope', text: 'Use project_slug or all_projects=true' }],
      },
    },
  });
});

it('a mutation without envelope tokens lists every missing value', async () => {
  await harness.project('alpha');
  const { status, body } = await send('POST', '/api/v1/projects/alpha/tasks', {
    payload: { title: 'x', kind: 'ordinary' },
  });
  expect(status).toBe(400);
  expect(body).toMatchObject({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Missing required values: operation_id, database_epoch (meta)',
      details: {
        field: 'operation_id',
        missing: [{ field: 'operation_id' }, { field: 'database_epoch' }],
      },
    },
  });
});

it('a mutation without revisions lists them together', async () => {
  const { status, body } = await send('POST', '/api/v1/projects/alpha/tasks', {
    operation_id: randomUUID(),
    database_epoch: harness.epoch,
    payload: { title: 'x', kind: 'ordinary' },
  });
  expect(status).toBe(400);
  expect(body).toMatchObject({
    error: {
      message: 'Missing required values: expected_config_revision (config get)',
      details: { field: 'expected_config_revision' },
    },
  });
});
