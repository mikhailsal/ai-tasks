import { jsonValueSchema } from '../../src/schema/values.js';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { createLazyDataHelper } from '../fixtures/lazy-data-helper.js';
import { createOrdinaryFixture, initialWork } from '../fixtures/ordinary-work.js';
const fixtures: Awaited<ReturnType<typeof createOrdinaryFixture>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});
it('reads a real project column in shared deterministic manual order', async () => {
  const fixture = await createOrdinaryFixture();
  fixtures.push(fixture);
  const { task } = await initialWork(fixture);
  const app = createApp({ helper: createLazyDataHelper({ databasePath: fixture.path }) });
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/alpha/board?kind=ordinary&status_id=idea',
      headers: { host: '127.0.0.1:3000' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: { items: [{ id: task.id }], next_cursor: null, order_revision: expect.any(Number) },
    });
  } finally {
    await app.close();
  }
});

it.each(['http', 'cli'] as const)(
  '%s reads and moves shared board positions with normal mutation contracts',
  async (transport) => {
    const fixture = await createOrdinaryFixture();
    fixtures.push(fixture);
    const { boardWork, boardInput, boardSnapshot } = await import('../fixtures/board.js');
    const { invokeOrdinaryCli } = await import('../fixtures/ordinary-work.js');
    const { successEnvelopeSchema, responseEnvelopeSchema } =
      await import('../../src/schema/envelopes.js');
    const { boardColumnEnvelopeSchema } = await import('../../src/schema/board.js');
    const { task, second, third } = await boardWork(fixture);
    const app = createApp({ helper: createLazyDataHelper({ databasePath: fixture.path }) });
    async function column() {
      if (transport === 'http') {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/projects/alpha/board?kind=ordinary&status_id=idea',
          headers: { host: '127.0.0.1:3000' },
        });
        expect(response.statusCode).toBe(200);
        return boardColumnEnvelopeSchema.parse(response.json());
      }
      const response = invokeOrdinaryCli(
        fixture,
        ['task', 'board', '--project', 'alpha', '--kind', 'ordinary', '--status', 'idea', '--json'],
        {},
      );
      expect(response.status, response.stderr).toBe(0);
      expect(response.stderr).toBe('');
      return boardColumnEnvelopeSchema.parse(JSON.parse(response.stdout));
    }
    async function position(request: ReturnType<typeof boardInput>, slug = 'alpha') {
      if (transport === 'http') {
        const response = await app.inject({
          method: 'POST',
          url: `/api/v1/projects/${slug}/tasks/${third.id}/position`,
          headers: {
            host: '127.0.0.1:3000',
            origin: 'http://127.0.0.1:3000',
            'x-ai-tasks-mutation': '1',
            'content-type': 'application/json',
          },
          payload: request,
        });
        return {
          status: response.statusCode,
          envelope: responseEnvelopeSchema.parse(response.json()),
        };
      }
      const payload =
        typeof request.payload === 'object' &&
        request.payload !== null &&
        !Array.isArray(request.payload)
          ? request.payload
          : {};
      const { payload: ignored, ...guards } = request;
      void ignored;
      const response = invokeOrdinaryCli(
        fixture,
        ['task', 'position', third.id, '--project', slug, '--json', '--input', '-'],
        jsonValueSchema.parse({ ...payload, ...guards }),
      );
      expect(response.status === 0 ? response.stderr : response.stdout).toBe('');
      return {
        status: response.status,
        envelope: responseEnvelopeSchema.parse(
          JSON.parse(response.status === 0 ? response.stdout : response.stderr),
        ),
      };
    }
    try {
      expect((await column()).data.items.map((row) => row.id)).toEqual([
        task.id,
        second.id,
        third.id,
      ]);
      const request = boardInput(fixture, third.id, 'idea', task.id);
      const response = await position(request);
      expect(response.status).toBe(transport === 'http' ? 200 : 0);
      expect(successEnvelopeSchema.parse(response.envelope).data).toMatchObject({
        id: third.id,
        revision: 2,
      });
      expect((await column()).data.items.map((row) => row.id)).toEqual([
        third.id,
        task.id,
        second.id,
      ]);
      const committed = boardSnapshot(fixture);
      expect(await position(request)).toEqual(response);
      expect((await position(boardInput(fixture, third.id), 'beta')).envelope).toMatchObject({
        ok: false,
        error: { code: 'PROJECT_MISMATCH' },
      });
      expect(
        (await position({ ...boardInput(fixture, third.id), payload: {} })).envelope,
      ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      expect(boardSnapshot(fixture)).toEqual(committed);
    } finally {
      await app.close();
    }
  },
);
