import { afterEach, expect, test } from 'vitest';
import { z } from 'zod/mini';
import { invokeOrdinaryCli } from '../fixtures/ordinary-work.js';
import { createReadViewsHarness, type ReadViewsHarness } from '../fixtures/read-views-contract.js';
const resultSchema = z.object({ data: z.object({ items: z.array(z.object({ id: z.uuid() })) }) });
let harness: ReadViewsHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});
test('HTTP and CLI exact-day and undated reads use shared predicates, preserve streams and reject invalid combinations', async () => {
  harness = await createReadViewsHarness();
  const h = harness;
  const seeded = h.seed({ asOf: Date.parse('2026-10-21T12:00:00Z'), timezone: 'Europe/Moscow' });
  const before = h.snapshot();
  const http = await h.request(
    'http',
    'tasks',
    { project_slug: 'classic' },
    { deadline_day: '2026-10-22', q: 'agenda:' },
  );
  expect(http.status).toBe(200);
  expect(resultSchema.parse(http.envelope).data.items.map((t) => t.id)).toEqual([
    seeded.idsByMeaning.next_start,
  ]);
  const cli = invokeOrdinaryCli(
    h.fixture,
    [
      'task',
      'list',
      '--project',
      'classic',
      '--json',
      '--input',
      '-',
      '--deadline-day',
      '2026-10-22',
    ],
    { q: 'agenda:' },
  );
  expect(cli.status, cli.stderr).toBe(0);
  expect(cli.stderr).toBe('');
  expect(cli.stdout.trimEnd().split('\n')).toHaveLength(1);
  expect(resultSchema.parse(JSON.parse(cli.stdout)).data.items.map((t) => t.id)).toEqual([
    seeded.idsByMeaning.next_start,
  ]);
  const undated = invokeOrdinaryCli(
    h.fixture,
    [
      'task',
      'list',
      '--project',
      'classic',
      '--json',
      '--input',
      '-',
      '--deadline-preset',
      'undated',
    ],
    { q: 'agenda:' },
  );
  expect(undated.status, undated.stderr).toBe(0);
  expect(resultSchema.parse(JSON.parse(undated.stdout)).data.items.map((t) => t.id)).toContain(
    seeded.idsByMeaning.undated,
  );
  const invalid = await h.request(
    'http',
    'tasks',
    { project_slug: 'classic' },
    { deadline_day: '2026-02-30' },
  );
  expect(invalid.status).toBe(400);
  const combined = await h.request(
    'http',
    'tasks',
    { project_slug: 'classic' },
    { deadline_day: '2026-10-22', deadline_preset: 'today' },
  );
  expect(combined.status).toBe(400);
  const cliInvalid = invokeOrdinaryCli(
    h.fixture,
    [
      'task',
      'list',
      '--project',
      'classic',
      '--json',
      '--input',
      '-',
      '--deadline-day',
      '2026-02-30',
    ],
    {},
  );
  expect(cliInvalid.status).toBe(2);
  expect(cliInvalid.stdout).toBe('');
  expect(JSON.parse(cliInvalid.stderr)).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION_ERROR' },
  });
  expect(h.snapshot()).toEqual(before);
});
