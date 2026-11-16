import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildFixture, cliRunner, type Cli } from '../fixtures/help-fixtures.js';
import { createUs2Harness } from '../fixtures/us2-contract.js';

/** Spec 008 progress and day filters through the compiled CLI and the HTTP route. */
const directory = mkdtempSync(join(tmpdir(), 'ai-tasks-progress-'));
let run: Cli;
let harness: Awaited<ReturnType<typeof createUs2Harness>>;
beforeAll(async () => {
  run = cliRunner(buildFixture('active_recurring_task', directory));
  harness = await createUs2Harness();
});
afterAll(async () => {
  await harness.close();
  rmSync(directory, { recursive: true, force: true });
});

function read(args: string[]): Record<string, unknown> {
  const response = run([...args, '--project', 'demo', '--json']);
  if (!response.body.ok) throw new Error(JSON.stringify(response.body.error));
  return response.body.data as Record<string, unknown>;
}

it('occurrence progress and the day filter agree with the listed occurrence day', () => {
  const task = (read(['task', 'list']).items as { id: string; kind: string }[]).find(
    (item) => item.kind === 'recurring',
  );
  if (!task) throw new Error('no recurring task');
  const [occurrence] = read(['occurrence', 'list', task.id]).items as {
    occurrence_day: string;
  }[];
  if (!occurrence) throw new Error('no occurrence');
  expect(occurrence.occurrence_day).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  const day = occurrence.occurrence_day;
  expect(read(['occurrence', 'list', task.id, '--day', day]).items).toHaveLength(1);
  expect(
    read(['occurrence', 'progress', task.id, '--from-day', day, '--to-day', day]),
  ).toMatchObject({ done: 0, decided: 0, open: 1, from_day: day, to_day: day });
  const human = run([
    'occurrence',
    'progress',
    task.id,
    '--project',
    'demo',
    '--from-day',
    day,
    '--to-day',
    day,
  ]);
  // Human output is not JSON; the runner keeps its text as the message.
  expect(human.status).toBe(0);
  expect(JSON.stringify(human.body)).toContain('0 из 0');
  const reversed = run([
    'occurrence',
    'progress',
    task.id,
    '--project',
    'demo',
    '--from-day',
    '2026-11-07',
    '--to-day',
    '2026-11-01',
    '--json',
  ]);
  expect(reversed.status).not.toBe(0);
  expect(reversed.body).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
});

it('the HTTP progress route passes the window through and refuses unknown fields', async () => {
  await harness.project('alpha');
  const url = (query: string) =>
    `/api/v1/projects/alpha/tasks/00000000-0000-4000-8000-000000000000/occurrences/progress?${query}`;
  const headers = { host: '127.0.0.1:3000' };
  const reversed = await harness.app.inject({
    method: 'GET',
    url: url('from_day=2026-11-07&to_day=2026-11-01'),
    headers,
  });
  expect(reversed.statusCode).toBe(400);
  expect(reversed.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  const missing = await harness.app.inject({
    method: 'GET',
    url: url('from_day=2026-11-01&to_day=2026-11-07'),
    headers,
  });
  expect(missing.json()).toMatchObject({ error: { code: 'TASK_NOT_FOUND' } });
  const unknown = await harness.app.inject({ method: 'GET', url: url('state=pending'), headers });
  expect(unknown.statusCode).toBe(400);
});
