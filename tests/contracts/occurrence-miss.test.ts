import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildFixture, cliRunner, type Cli } from '../fixtures/help-fixtures.js';
import { createUs2Harness } from '../fixtures/us2-contract.js';

/** Spec 007 through the compiled CLI and the HTTP route. */
const directory = mkdtempSync(join(tmpdir(), 'ai-tasks-miss-'));
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

it('occurrence miss records the reason and every read shows it', () => {
  const task = (read(['task', 'list']).items as { id: string; kind: string }[]).find(
    (item) => item.kind === 'recurring',
  );
  if (!task) throw new Error('no recurring task');
  const [occurrence] = read(['occurrence', 'list', task.id]).items as {
    id: string;
    revision: number;
  }[];
  if (!occurrence) throw new Error('no occurrence');
  const before = run(['occurrence', 'get', task.id, occurrence.id, '--project', 'demo', '--json']);
  expect(JSON.stringify(before.body)).not.toMatch(/miss_reason|completion_note/u);
  const epoch = run(['meta', '--all-projects', '--json']).body.meta?.database_epoch;
  const result = run(
    ['occurrence', 'miss', task.id, '--project', 'demo', '--input', '-', '--json'],
    {
      operation_id: randomUUID(),
      database_epoch: epoch,
      expected_revision: read(['task', 'get', task.id]).revision,
      expected_config_revision: read(['config', 'get']).revision,
      expected_settings_revision: read(['settings', 'get']).revision,
      occurrences: [{ id: occurrence.id, expected_revision: occurrence.revision }],
      reason: 'он сказал нет',
    },
  );
  expect(result.status).toBe(0);
  expect(read(['occurrence', 'get', task.id, occurrence.id])).toMatchObject({
    state: 'missed',
    miss_reason: 'он сказал нет',
    miss_reason_recorded_at: expect.any(String),
  });
});

it('the HTTP route reaches the miss command', async () => {
  await harness.project('alpha');
  const task = randomUUID();
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/v1/projects/alpha/tasks/${task}/occurrences/miss`,
    headers: {
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      'content-type': 'application/json',
      'x-ai-tasks-mutation': '1',
    },
    payload: JSON.stringify({
      operation_id: randomUUID(),
      database_epoch: harness.epoch,
      payload: { occurrences: [{ id: randomUUID(), expected_revision: 1 }], reason: 'нет' },
    }),
  });
  expect(response.statusCode).toBe(404);
  expect(response.json()).toMatchObject({
    ok: false,
    error: { code: 'TASK_NOT_FOUND', details: { entity_id: task } },
  });
});
