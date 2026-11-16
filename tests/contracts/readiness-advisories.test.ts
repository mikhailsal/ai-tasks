import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFixture, cliRunner, type Cli } from '../fixtures/help-fixtures.js';
import { createUs2Harness } from '../fixtures/us2-contract.js';

/** Specs 010 and 012 through the compiled CLI and HTTP. */
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const first = new Date(Date.now() + 2 * 86400000).toISOString();
const recurrence = {
  first_deadline: first,
  schedule: { mode: 'calendar', pattern: 'days', every: 1 },
  miss_policy: 'record_miss',
  confirmation_window_ms: 3600000,
};
type Body = Record<string, unknown> & { advisories?: { code: string; subject?: { id: string } }[] };
const codes = (body: Body) => body.advisories?.map((item) => item.code);

describe('CLI', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-tasks-advisories-'));
  let env: NodeJS.ProcessEnv;
  let run: Cli;
  beforeAll(() => {
    env = buildFixture('empty_project', directory);
    run = cliRunner(env);
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  const read = (args: string[]) => run([...args, '--json']).body as Body;
  const value = (args: string[], path: (data: Record<string, unknown>) => unknown) =>
    path(read(args).data as Record<string, unknown>);

  it('a draft carries the advisory on create and reads; human mode puts it on stderr only', () => {
    const created = run(['task', 'create', '--project', 'demo', '--input', '-', '--json'], {
      operation_id: randomUUID(),
      database_epoch: (read(['meta', '--all-projects']).meta as { database_epoch: string })
        .database_epoch,
      expected_config_revision: value(
        ['config', 'get', '--project', 'demo'],
        (data) => data.revision,
      ),
      expected_settings_revision: value(
        ['settings', 'get', '--all-projects'],
        (data) => data.revision,
      ),
      kind: 'recurring',
      title: 'Черновик',
      recurrence,
    });
    expect(created.status).toBe(0);
    const body = created.body as Body;
    expect(codes(body)).toEqual(['recurring_not_generating', 'schedule_time_derived']);
    const id = String((body.data as { id: string }).id);
    expect(codes(read(['task', 'get', id, '--project', 'demo']))).toEqual([
      'recurring_not_generating',
    ]);
    expect(codes(read(['recurrence', 'get', id, '--project', 'demo']))).toEqual([
      'recurring_not_generating',
    ]);
    const human = spawnSync(process.execPath, [cli, 'task', 'get', id, '--project', 'demo'], {
      env,
      encoding: 'utf8',
    });
    expect(human.status).toBe(0);
    expect(human.stdout).not.toContain('advisory');
    expect(human.stderr).toBe(
      'advisory: recurring_not_generating: This recurring task generates no occurrences in its current status. (Move it to an active status: active.)\n',
    );
  });

  it('a response nothing applies to has exactly the old keys (US4-1)', () => {
    const body = read(['project', 'get', '--project', 'demo']);
    expect(Object.keys(body)).toEqual(['ok', 'data', 'meta']);
  });
});

describe('HTTP', () => {
  let harness: Awaited<ReturnType<typeof createUs2Harness>>;
  beforeAll(async () => {
    harness = await createUs2Harness();
    await harness.project('alpha');
  });
  afterAll(async () => harness.close());
  async function send(method: 'GET' | 'POST', url: string, payload?: unknown) {
    const response = await harness.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
        'content-type': 'application/json',
        'x-ai-tasks-mutation': '1',
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
    return { status: response.statusCode, body: response.json<Body>() };
  }
  const revision = async (url: string) =>
    ((await send('GET', url)).body.data as { revision: number }).revision;

  it('the same keys reach HTTP clients, and only when they apply', async () => {
    const created = await send('POST', '/projects/alpha/tasks', {
      operation_id: randomUUID(),
      database_epoch: harness.epoch,
      expected_config_revision: await revision('/projects/alpha/config'),
      expected_settings_revision: await revision('/settings?all_projects=true'),
      payload: { kind: 'recurring', title: 'Черновик', recurrence },
    });
    expect(created.status).toBe(201);
    expect(codes(created.body)).toEqual(['recurring_not_generating', 'schedule_time_derived']);
    const id = (created.body.data as { id: string }).id;
    const got = await send('GET', `/projects/alpha/tasks/${id}`);
    expect(got.body.advisories).toEqual([
      expect.objectContaining({
        code: 'recurring_not_generating',
        remedy: expect.objectContaining({ action: 'transition_task' }),
        subject: { type: 'task', id },
      }),
    ]);
    expect(Object.keys((await send('GET', '/projects/alpha')).body)).toEqual([
      'ok',
      'data',
      'meta',
    ]);
  });
});
