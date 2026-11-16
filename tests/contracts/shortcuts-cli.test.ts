import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildFixture, cliRunner, type Cli } from '../fixtures/help-fixtures.js';

/** Spec 009 through the compiled CLI: case tables of contracts/shortcuts.md and a race. */
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'ai-tasks-shortcuts-'));
let recurring: { run: Cli; env: NodeJS.ProcessEnv };
let ordinary: Cli;
beforeAll(() => {
  const env = buildFixture('active_recurring_task', join(directory, 'recurring'));
  recurring = { run: cliRunner(env), env };
  ordinary = cliRunner(buildFixture('ordinary_task', join(directory, 'ordinary')));
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function data(run: Cli, args: string[]) {
  const response = run([...args, '--project', 'demo', '--json']);
  if (!response.body.ok) throw new Error(JSON.stringify(response.body.error));
  return response.body.data as Record<string, unknown>;
}
function spawnCli(env: NodeJS.ProcessEnv, args: string[]) {
  return new Promise<{ status: number | null; body: Record<string, unknown> }>((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { env });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.on('close', (status) =>
      resolve({
        status,
        body: JSON.parse(out.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>,
      }),
    );
  });
}

it('occurrence done: two racing processes complete once; the other gets the record', async () => {
  const task = (data(recurring.run, ['task', 'list']).items as { id: string; kind: string }[]).find(
    (item) => item.kind === 'recurring',
  );
  if (!task) throw new Error('no recurring task');
  const [occurrence] = data(recurring.run, ['occurrence', 'list', task.id]).items as {
    id: string;
    occurrence_day: string;
  }[];
  if (!occurrence) throw new Error('no occurrence');
  const args = [
    'occurrence',
    'done',
    task.id,
    '--project',
    'demo',
    '--day',
    occurrence.occurrence_day,
    '--json',
  ];
  const results = await Promise.all([spawnCli(recurring.env, args), spawnCli(recurring.env, args)]);
  expect(results.map((result) => result.status)).toEqual([0, 0]);
  const existing = results.map(
    (result) => (result.body.data as { existing?: boolean }).existing === true,
  );
  expect(existing.filter(Boolean)).toHaveLength(1);
  expect(data(recurring.run, ['occurrence', 'get', task.id, occurrence.id]).state).toBe(
    'completed',
  );
  const none = recurring.run([
    'occurrence',
    'done',
    task.id,
    '--project',
    'demo',
    '--day',
    '2000-01-01',
    '--json',
  ]);
  expect(none.status).toBe(3);
  expect(none.body).toMatchObject({
    ok: false,
    error: {
      code: 'TASK_NOT_FOUND',
      details: { nearest_days: { earlier: null, later: occurrence.occurrence_day } },
    },
  });
});

it('task move: allowed, already there, stale --from, and no tokens accepted', () => {
  const [task] = data(ordinary, ['task', 'list']).items as { id: string; status_id: string }[];
  if (!task) throw new Error('no ordinary task');
  const moved = ordinary([
    'task',
    'move',
    task.id,
    '--project',
    'demo',
    '--to',
    'planning',
    '--from',
    task.status_id,
    '--json',
  ]);
  expect(moved).toMatchObject({ status: 0, body: { ok: true, data: { status_id: 'planning' } } });
  const again = ordinary([
    'task',
    'move',
    task.id,
    '--project',
    'demo',
    '--to',
    'planning',
    '--json',
  ]);
  expect(again.body).toMatchObject({ ok: true, data: { existing: true } });
  const stale = ordinary([
    'task',
    'move',
    task.id,
    '--project',
    'demo',
    '--to',
    'idea',
    '--from',
    'idea',
    '--json',
  ]);
  expect(stale).toMatchObject({
    status: 2,
    body: { error: { details: { actual_status: 'planning' } } },
  });
  const tokens = ordinary([
    'task',
    'move',
    task.id,
    '--project',
    'demo',
    '--to',
    'idea',
    '--expected-revision',
    '2',
    '--json',
  ]);
  expect(tokens.status).toBe(2);
  expect(tokens.body).toMatchObject({
    error: { details: { supported_options: expect.not.arrayContaining(['--expected-revision']) } },
  });
});
