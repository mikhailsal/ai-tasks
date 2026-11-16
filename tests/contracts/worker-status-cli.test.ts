import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildFixture, cliRunner, type Cli } from '../fixtures/help-fixtures.js';

/** Spec 011 through the compiled CLI: status in meta and project reads, advisory, remedy. */
type Advisory = { code: string; remedy: { action: string; command?: string; text: string } };
type Body = Record<string, unknown> & { advisories?: Advisory[] };
const directory = mkdtempSync(join(tmpdir(), 'ai-tasks-worker-status-'));
let run: Cli;
beforeAll(() => {
  run = cliRunner(buildFixture('empty_project', directory));
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const read = (args: string[]) => run([...args, '--json']).body as Body;
const data = (args: string[]) => read(args).data as Record<string, unknown>;
function tokens() {
  return {
    operation_id: randomUUID(),
    database_epoch: (read(['meta', '--all-projects']).meta as { database_epoch: string })
      .database_epoch,
    expected_config_revision: data(['config', 'get', '--project', 'demo']).revision,
    expected_settings_revision: data(['settings', 'get', '--all-projects']).revision,
  };
}

it('reports never in meta and project reads; an active recurring task gets the advisory (US1-3, US2, FR-006)', () => {
  expect(data(['meta', '--all-projects']).workers).toEqual([
    { project_slug: 'demo', status: 'never', tolerance_seconds: 300 },
  ]);
  expect(data(['project', 'get', '--project', 'demo']).worker).toEqual({ status: 'never' });
  const created = run(['task', 'create', '--project', 'demo', '--input', '-', '--json'], {
    ...tokens(),
    kind: 'recurring',
    title: 'Ежедневно',
    recurrence: {
      first_deadline: new Date(Date.now() + 86400000).toISOString(),
      schedule: { mode: 'calendar', pattern: 'days', every: 1 },
      miss_policy: 'record_miss',
      confirmation_window_ms: 3600000,
    },
  }).body as Body;
  const task = created.data as { id: string; revision: number };
  // A draft does not depend on the worker yet.
  expect(
    read(['task', 'get', task.id, '--project', 'demo']).advisories?.map((a) => a.code),
  ).toEqual(['recurring_not_generating']);
  const control = run(
    ['recurrence', 'control', task.id, '--project', 'demo', '--input', '-', '--json'],
    { ...tokens(), expected_revision: task.revision, to_status_id: 'active' },
  );
  expect(control.status).toBe(0);
  const advisories = read(['occurrence', 'list', task.id, '--project', 'demo']).advisories;
  expect(advisories).toEqual([
    {
      code: 'worker_never_ran',
      message: 'The recurring worker has never run for this project; no occurrences are created.',
      remedy: {
        action: 'start_service',
        text: 'Start the service (serve), which runs the worker; manual: worker run --project demo.',
        command: 'serve',
      },
      subject: { type: 'project', id: 'demo' },
    },
  ]);
  expect(Object.keys(read(['project', 'get', '--project', 'demo']))).toEqual([
    'ok',
    'data',
    'meta',
  ]);
});
