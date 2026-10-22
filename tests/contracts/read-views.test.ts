import { expect, it } from 'vitest';
import { errorEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import {
  agendaPageSchema,
  prioritiesPageSchema,
  statisticsSchema,
} from '../fixtures/read-views-responses.js';
import { installReadViewHarness, validReadView } from '../fixtures/read-views-registrations.js';
const current = installReadViewHarness();
it('agenda succeeds through the real HTTP boundary after metadata proves the migrated database [US4 behavioral RED]', async () => {
  const harness = current();
  const control = await harness.request('http', 'meta');
  expect(control.status).toBe(200);
  expect(successEnvelopeSchema.parse(control.envelope).data).toMatchObject({
    database_epoch: harness.fixture.epoch,
  });
  const agenda = await harness.request('http', 'agenda');
  expect(agenda.status, JSON.stringify(agenda.envelope)).toBe(200);
});

it.each(['agenda', 'priorities', 'stats'] as const)(
  '%s CLI/HTTP data parity retains project/model context and every read is pure',
  async (view) => {
    const harness = current();
    harness.seed();
    const before = harness.snapshot();
    const http = validReadView(
      await harness.request(
        'http',
        view,
        { all_projects: true },
        view === 'stats' ? {} : { limit: 200 },
      ),
      'http',
    );
    const cli = validReadView(
      await harness.request(
        'cli',
        view,
        { all_projects: true },
        view === 'stats' ? {} : { limit: 200 },
      ),
      'cli',
    );
    // Statistics has no pagination arguments; use its default full inventory on both adapters.
    const schema =
      view === 'agenda'
        ? agendaPageSchema
        : view === 'priorities'
          ? prioritiesPageSchema
          : statisticsSchema;
    const left = schema.parse(http);
    const right = schema.parse(cli);
    expect(right.data).toEqual(left.data);
    expect(left.meta.as_of).toBeDefined();
    expect(right.meta.as_of).toBeDefined();
    expect(left.meta.timezone).toBe('Europe/Berlin');
    expect(harness.snapshot()).toEqual(before);
  },
);

it.each(['agenda', 'priorities', 'stats'] as const)(
  '%s HTTP requires one explicit scope and rejects mixed scope and injected clocks',
  async (view) => {
    const harness = current();
    harness.seed();
    const before = harness.snapshot();
    const host = new URL(harness.origin).host;
    for (const query of [
      '',
      '?project_slug=classic&all_projects=true',
      '?all_projects=true&as_of=2026-01-01T00%3A00%3A00.000Z',
      '?all_projects=true&now=2026-01-01T00%3A00%3A00.000Z',
    ]) {
      const result = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/${view}${query}`,
        headers: { host },
      });
      expect(result.statusCode).toBe(400);
      expect(errorEnvelopeSchema.parse(result.json()).error.code).toBe('VALIDATION_ERROR');
    }
    expect(harness.snapshot()).toEqual(before);
  },
);
