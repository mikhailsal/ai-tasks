import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExampleFixture } from '../../src/cli/registry/types.js';

/** Named states for help examples (spec 005 R5), built only through the compiled CLI. */
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const migration = fileURLToPath(new URL('../../dist/migrate.js', import.meta.url));

export type Envelope = {
  ok: boolean;
  data?: unknown;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details: unknown };
};
export type Cli = (args: string[], input?: unknown) => { status: number | null; body: Envelope };

export function cliRunner(env: NodeJS.ProcessEnv): Cli {
  return (args, input) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      env,
      input: input === undefined ? undefined : JSON.stringify(input),
      encoding: 'utf8',
      timeout: 15_000,
    });
    const text = (result.status === 0 ? result.stdout : result.stderr).trim();
    let body: Envelope;
    try {
      body = JSON.parse(text.split('\n').at(-1) ?? '') as Envelope;
    } catch {
      body = { ok: false, error: { code: 'NOT_JSON', message: text.slice(0, 500), details: null } };
    }
    return { status: result.status, body };
  };
}

function data(response: { body: Envelope }): Record<string, unknown> {
  if (!response.body.ok)
    throw new Error(`fixture step failed: ${JSON.stringify(response.body.error)}`);
  return response.body.data as Record<string, unknown>;
}

function tokens(run: Cli, extra: { revision?: unknown; settings?: boolean } = {}) {
  const epoch = run(['meta', '--all-projects', '--json']).body.meta?.database_epoch;
  const config = data(run(['config', 'get', '--project', 'demo', '--json'])).revision;
  const settings = extra.settings
    ? {
        expected_settings_revision: data(run(['settings', 'get', '--project', 'demo', '--json']))
          .revision,
      }
    : {};
  return {
    operation_id: randomUUID(),
    database_epoch: epoch,
    expected_config_revision: config,
    ...(extra.revision === undefined ? {} : { expected_revision: extra.revision }),
    ...settings,
  };
}

function recurringTask(run: Cli, status: 'active' | 'paused'): string {
  const first = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const created = data(
    run(['task', 'create', '--project', 'demo', '--input', '-', '--json'], {
      ...tokens(run, { settings: true }),
      kind: 'recurring',
      title: 'Daily habit',
      recurrence: {
        first_deadline: first,
        schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '09:00:00.000' },
        miss_policy: 'carry_forward',
        confirmation_window_ms: 3_600_000,
      },
    }),
  );
  const id = String(created.id);
  for (const target of status === 'active' ? ['active'] : ['active', 'paused']) {
    const revision = data(run(['task', 'get', id, '--project', 'demo', '--json'])).revision;
    data(
      run(['recurrence', 'control', id, '--project', 'demo', '--input', '-', '--json'], {
        ...tokens(run, { revision, settings: true }),
        to_status_id: target,
      }),
    );
  }
  return id;
}

function ordinaryTask(run: Cli, title: string): string {
  return String(
    data(
      run(['task', 'create', '--project', 'demo', '--input', '-', '--json'], {
        ...tokens(run),
        kind: 'ordinary',
        title,
      }),
    ).id,
  );
}

function taskRevision(run: Cli, id: string): unknown {
  return data(run(['task', 'get', id, '--project', 'demo', '--json'])).revision;
}

/** Ordinary-work states: one task, two tasks, a link between them, or archived rows. */
function ordinaryFixture(run: Cli, fixture: ExampleFixture): void {
  if (fixture === 'archived_project') {
    const revision = data(run(['project', 'get', '--project', 'demo', '--json'])).revision;
    data(
      run(['project', 'archive', '--project', 'demo', '--input', '-', '--json'], {
        ...tokens(run, { revision }),
        affected_tasks: [],
      }),
    );
    return;
  }
  if (!['ordinary_task', 'two_ordinary_tasks', 'linked_tasks', 'archived_task'].includes(fixture))
    return;
  const first = ordinaryTask(run, 'Example task');
  if (fixture === 'archived_task')
    data(
      run(
        ['task', 'archive', first, '--project', 'demo', '--input', '-', '--json'],
        tokens(run, { revision: taskRevision(run, first) }),
      ),
    );
  if (fixture !== 'two_ordinary_tasks' && fixture !== 'linked_tasks') return;
  const second = ordinaryTask(run, 'Prerequisite task');
  if (fixture === 'linked_tasks')
    data(
      run(['dependency', 'add', first, '--project', 'demo', '--input', '-', '--json'], {
        ...tokens(run, { revision: taskRevision(run, first) }),
        prerequisite_task_id: second,
        prerequisite_project_slug: 'demo',
      }),
    );
}

/** Builds `fixture` in `directory` and returns the environment the examples run with. */
export function buildFixture(fixture: ExampleFixture, directory: string): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    AI_TASKS_DB_PATH: join(directory, 'db.sqlite'),
    AI_TASKS_BACKUP_DIR: join(directory, 'backups'),
  };
  if (fixture === 'no_database') return env;
  const migrated = spawnSync(process.execPath, [migration], { env, encoding: 'utf8' });
  if (migrated.status !== 0) throw new Error(`migration failed: ${migrated.stderr}`);
  const run = cliRunner(env);
  const epoch = run(['meta', '--all-projects', '--json']).body.meta?.database_epoch;
  data(
    run(['project', 'create', '--project', 'demo', '--input', '-', '--json'], {
      operation_id: randomUUID(),
      database_epoch: epoch,
      slug: 'demo',
      name: 'Demo',
      emoji: '🧭',
    }),
  );
  ordinaryFixture(run, fixture);
  if (fixture === 'active_recurring_task') recurringTask(run, 'active');
  if (fixture === 'paused_recurring_with_future') recurringTask(run, 'paused');
  if (fixture === 'managed_backup')
    data(
      run(
        ['backup', 'create', '--project', 'demo', '--input', '-', '--json'],
        tokens(run, { settings: true }),
      ),
    );
  return env;
}
