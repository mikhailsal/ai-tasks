import { afterAll, beforeAll, expect, it } from 'vitest';
import { createUs2Harness } from '../fixtures/us2-contract.js';

/** Spec 011 over HTTP: the same status and tolerance as the CLI. */
let harness: Awaited<ReturnType<typeof createUs2Harness>>;
beforeAll(async () => {
  harness = await createUs2Harness();
  await harness.project('alpha');
});
afterAll(async () => harness.close());
async function get(url: string) {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/v1${url}`,
    headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: Record<string, unknown> }>().data;
}

it('meta and project resources carry the worker status (FR-002, FR-003)', async () => {
  expect(await get('/meta?all_projects=true')).toMatchObject({
    workers: [{ project_slug: 'alpha', status: 'never', tolerance_seconds: 300 }],
  });
  expect((await get('/projects/alpha')).worker).toEqual({ status: 'never' });
  const list = (await get('/projects?all_projects=true')).items as { worker: unknown }[];
  expect(list.map((item) => item.worker)).toEqual([{ status: 'never' }]);
});
