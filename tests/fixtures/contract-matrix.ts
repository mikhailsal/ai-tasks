import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { z } from 'zod/mini';
import { responseEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import type { JsonValue } from '../../src/schema/values.js';
import { createUs2Harness, customConfig } from './us2-contract.js';
export type Story = 'Foundation' | 'US1' | 'US2' | 'US3' | 'US4' | 'US5' | 'US6';
type Route = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  pattern: string;
  status: number;
};
export type MatrixRow = {
  command: string;
  kind: 'R' | 'M' | 'O';
  owner: Story;
  readiness: 'ready' | 'target' | 'pending';
  reason: string;
  evidence: string | null;
  http: Route[];
};
export const recoveryContractSuite = 'tests/contracts/recovery.test.ts';
export const recoveryContractEntries = [
  { transport: 'cli', entry: 'tests/contracts/recovery-cli.test.ts' },
  { transport: 'http', entry: 'tests/contracts/recovery-http.test.ts' },
] as const;
export const recoveryRegistrations = 'tests/fixtures/recovery-registrations.ts';
const recoveryCases = {
  consent: 'restore rejects %s without publishing or changing epoch',
  claims: 'restore refuses %s affected-project claim atomically',
  boundary: 'refuses filesystem paths, missing scope and actor injection at the actual boundary',
  creation:
    'creates an opaque managed manifest, exact replay and pure list/validation without domain receipts',
  paging:
    'pages opaque backup IDs in stable descending creation order and rejects an oversized limit',
  guards: 'rejects changed operation payload, stale settings/config/epoch without a domain write',
  restore:
    'restores once, exposes durable job and lost-response operation lookup, then rejects exact old-epoch retry',
  currentUnion:
    'validation and restore cover current-only scope and refuse incomplete or stale union claims',
  backupUnion: 'backup-only union claims use null revisions and restore adds the missing project',
  lookup: 'requires exactly one status lookup key and all-projects read scope',
  maintenance:
    'the supervisor serves job status by both IDs while ordinary database reads report maintenance',
};
/** These accepted rows need managed snapshot/job setup and the real supervisor, not generic placeholders. */
export const recoveryDelegations = [
  {
    command: 'backup list',
    scenarios: [recoveryCases.paging, recoveryCases.creation, recoveryCases.boundary],
  },
  {
    command: 'backup create',
    scenarios: [recoveryCases.creation, recoveryCases.guards, recoveryCases.boundary],
  },
  {
    command: 'backup validate <backup-id>',
    scenarios: [
      recoveryCases.creation,
      recoveryCases.currentUnion,
      recoveryCases.backupUnion,
      recoveryCases.boundary,
    ],
  },
  {
    command: 'backup restore',
    scenarios: [
      recoveryCases.restore,
      recoveryCases.consent,
      recoveryCases.claims,
      recoveryCases.currentUnion,
      recoveryCases.backupUnion,
    ],
  },
  {
    command: 'backup status [job-id]',
    scenarios: [recoveryCases.lookup, recoveryCases.restore, recoveryCases.maintenance],
  },
] as const;
const P = '/projects/:project_slug';
const T = `${P}/tasks/:task_id`;
function row(
  command: string,
  kind: MatrixRow['kind'],
  owner: Story,
  route?: Partial<Route> & {
    pattern: string;
  },
): MatrixRow {
  const readiness = ['Foundation', 'US1', 'US2', 'US3', 'US4', 'US5', 'US6'].includes(owner)
    ? 'ready'
    : 'pending';
  return {
    command,
    kind,
    owner,
    readiness,
    evidence:
      readiness === 'pending'
        ? null
        : owner === 'US6'
          ? recoveryContractSuite
          : owner === 'Foundation'
            ? 'tests/contracts/bootstrap.test.ts'
            : owner === 'US1'
              ? 'tests/contracts/ordinary-work.test.ts'
              : owner === 'US2'
                ? 'tests/contracts/configuration-dependencies.test.ts'
                : owner === 'US4'
                  ? 'tests/contracts/read-views.test.ts'
                  : owner === 'US5'
                    ? command === 'worker run'
                      ? 'tests/integration/worker.test.ts'
                      : 'tests/contracts/recurrence-settings.test.ts'
                    : 'tests/contracts/command-matrix.test.ts',
    reason:
      readiness === 'pending'
        ? `Behavior requires ${owner}; inventory only until its story gate.`
        : 'Foundation, ordinary, configuration, dependency, history, read-view, recurrence, settings and recovery adapters accepted through their explicit story gates.',
    http: route
      ? [{ method: route.method ?? 'GET', pattern: route.pattern, status: route.status ?? 200 }]
      : [],
  };
}
/** Every application table row, including unimplemented families: no existence-based filtering. */
export const commandMatrix: readonly MatrixRow[] = [
  row('meta', 'R', 'Foundation', { pattern: '/meta' }),
  row('serve', 'O', 'Foundation'),
  row('worker run', 'O', 'US5'),
  row('project list', 'R', 'US1', { pattern: '/projects' }),
  row('project get', 'R', 'US1', { pattern: P }),
  row('project create', 'M', 'US1', { pattern: P, method: 'POST', status: 201 }),
  row('project update', 'M', 'US1', { pattern: P, method: 'PATCH' }),
  row('project archive', 'M', 'US1', { pattern: `${P}/archive`, method: 'POST' }),
  row('project restore', 'M', 'US1', { pattern: `${P}/restore`, method: 'POST' }),
  row('config presets', 'R', 'US1', { pattern: '/config/presets' }),
  row('config get', 'R', 'US1', { pattern: `${P}/config` }),
  row('config preview', 'R', 'US2', { pattern: `${P}/config/preview`, method: 'POST' }),
  row('config migrate', 'M', 'US2', { pattern: `${P}/config/migrate`, method: 'POST' }),
  row('task list', 'R', 'US1', { pattern: '/tasks' }),
  row('task get <task-id>', 'R', 'US1', { pattern: T }),
  row('task create', 'M', 'US1', { pattern: `${P}/tasks`, method: 'POST', status: 201 }),
  row('task update <task-id>', 'M', 'US1', { pattern: T, method: 'PATCH' }),
  row('task transition <task-id>', 'M', 'US1', { pattern: `${T}/transitions`, method: 'POST' }),
  row('task archive <task-id>', 'M', 'US1', { pattern: `${T}/archive`, method: 'POST' }),
  row('task restore <task-id>', 'M', 'US1', { pattern: `${T}/restore`, method: 'POST' }),
  row('description preview', 'R', 'US1', { pattern: `${P}/description/preview`, method: 'POST' }),
  row('dependency list <task-id>', 'R', 'US2', { pattern: `${T}/dependencies` }),
  row('dependency add <task-id>', 'M', 'US2', {
    pattern: `${T}/dependencies`,
    method: 'POST',
    status: 201,
  }),
  row('dependency remove <task-id>', 'M', 'US2', {
    pattern: `${T}/dependencies/remove`,
    method: 'POST',
  }),
  row('recurrence get <task-id>', 'R', 'US5', { pattern: `${T}/recurrence` }),
  row('recurrence configure <task-id>', 'M', 'US5', { pattern: `${T}/recurrence`, method: 'PUT' }),
  row('recurrence control <task-id>', 'M', 'US5', {
    pattern: `${T}/recurrence/control`,
    method: 'POST',
  }),
  row('recurrence tick', 'M', 'US5', { pattern: `${P}/recurrence/tick`, method: 'POST' }),
  row('occurrence list <task-id>', 'R', 'US5', { pattern: `${T}/occurrences` }),
  row('occurrence get <task-id> <occurrence-id>', 'R', 'US5', {
    pattern: `${T}/occurrences/:occurrence_id`,
  }),
  row('occurrence complete <task-id>', 'M', 'US5', {
    pattern: `${T}/occurrences/complete`,
    method: 'POST',
  }),
  row('occurrence cancel <task-id>', 'M', 'US5', {
    pattern: `${T}/occurrences/cancel`,
    method: 'POST',
  }),
  row('agenda', 'R', 'US4', { pattern: '/agenda' }),
  row('priorities', 'R', 'US4', { pattern: '/priorities' }),
  row('stats', 'R', 'US4', { pattern: '/stats' }),
  row('audit list', 'R', 'US3', { pattern: '/audit' }),
  row('settings get', 'R', 'US5', { pattern: '/settings' }),
  row('settings update', 'M', 'US5', { pattern: `${P}/application-settings`, method: 'PATCH' }),
  row('backup list', 'R', 'US6', { pattern: '/backups' }),
  row('backup create', 'O', 'US6', { pattern: `${P}/backups`, method: 'POST', status: 201 }),
  row('backup validate <backup-id>', 'R', 'US6', {
    pattern: '/backups/:backup_id/validate',
    method: 'POST',
  }),
  row('backup restore', 'O', 'US6', {
    pattern: `${P}/backups/restore`,
    method: 'POST',
    status: 202,
  }),
  {
    ...row('backup status [job-id]', 'R', 'US6', { pattern: '/backups/jobs/:job_id' }),
    http: [
      { method: 'GET', pattern: '/backups/jobs/:job_id', status: 200 },
      { method: 'GET', pattern: '/backups/jobs', status: 200 },
    ],
  },
];
export const informationalCommands = [
  ['help', '--json'],
  ['version', '--json'],
  ['--help'],
  ['--version'],
] as const;
export const informationalEvidence = {
  owner: 'Foundation',
  readiness: 'ready',
  suite: 'tests/contracts/bootstrap.test.ts',
} as const;
export const laterExtensions = {
  US5: [
    'serve',
    'project archive',
    'project restore',
    'task create',
    'task transition <task-id>',
    'task archive <task-id>',
    'task restore <task-id>',
    'config preview',
    'config migrate',
  ],
};
export type MatrixHarness = Awaited<ReturnType<typeof createMatrixHarness>>;
export const matrixCli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
export function invokeMatrixCli(path: string, args: string[], input?: string) {
  const result = spawnSync(process.execPath, [matrixCli, ...args], {
    env: { ...process.env, AI_TASKS_DB_PATH: path },
    input,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 2097152,
  });
  if (result.error) throw result.error;
  expect(result.signal).toBeNull();
  return result;
}
export function jsonLine(output: string): unknown {
  expect(output.endsWith('\n')).toBe(true);
  expect(output.split('\n')).toHaveLength(2);
  expect(output.includes(String.fromCharCode(27) + '[')).toBe(false);
  return JSON.parse(output);
}
export async function createMatrixHarness() {
  const harness = await createUs2Harness();
  try {
    await harness.project();
    await harness.project('beta', '🌲');
    const task = await harness.task();
    const prerequisite = await harness.task('beta');
    return {
      ...harness,
      task,
      prerequisite,
      snapshot() {
        return [
          ...harness.snapshot(),
          ...[
            'schedule_generations',
            'recurrence_state',
            'recurrence_intervals',
            'occurrences',
          ].map((table) =>
            harness.fixture.connection.sqlite
              .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
              .all(),
          ),
        ];
      },
    };
  } catch (error) {
    await harness.close();
    throw error;
  }
}
type RecurringReadTarget = {
  taskId: string;
  occurrenceId: string;
};
const recurringTargets = new WeakMap<MatrixHarness, RecurringReadTarget>();
async function seedReadMutation(
  harness: MatrixHarness,
  path: string,
  payload: JsonValue,
  revision?: number,
) {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: {
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      'content-type': 'application/json',
      'x-ai-tasks-mutation': '1',
    },
    payload: {
      operation_id: randomUUID(),
      database_epoch: harness.epoch,
      expected_config_revision: 1,
      expected_settings_revision: 1,
      ...(revision === undefined ? {} : { expected_revision: revision }),
      payload,
    },
  });
  expect(response.statusCode).toBe(path.endsWith('/tasks') ? 201 : 200);
  return successEnvelopeSchema.parse(response.json());
}
/** Only recurrence read rows seed this child; ordinary lifecycle fixtures keep exact child sets. */
async function recurringReadTarget(harness: MatrixHarness): Promise<RecurringReadTarget> {
  const cached = recurringTargets.get(harness);
  if (cached) return cached;
  const created = await seedReadMutation(harness, '/projects/alpha/tasks', {
    kind: 'recurring',
    title: 'Матрица чтения повторений',
    recurrence: {
      first_deadline: new Date(Date.now() + 86400000).toISOString(),
      schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '13:00:00.123' },
      miss_policy: 'carry_forward',
      confirmation_window_ms: 0,
    },
  });
  const task = z
    .object({ id: z.uuid(), revision: z.int().check(z.positive()) })
    .parse(created.data);
  await seedReadMutation(
    harness,
    `/projects/alpha/tasks/${task.id}/recurrence/control`,
    {
      to_status_id: 'active',
    },
    task.revision,
  );
  const occurrence = z
    .object({ id: z.uuid() })
    .parse(
      harness.fixture.connection.sqlite
        .prepare('SELECT id FROM occurrences WHERE task_id=? ORDER BY deadline,id LIMIT 1')
        .get(task.id),
    );
  const target = { taskId: task.id, occurrenceId: occurrence.id };
  recurringTargets.set(harness, target);
  return target;
}
export type MatrixInvocation = {
  command: string[];
  path: string;
  method: 'GET' | 'POST' | 'PATCH';
  scope?: string;
  body?: Record<string, JsonValue>;
  mutation?: boolean;
  revision?: number;
  configRevision?: number;
  operationId?: string;
  epoch?: string;
};
async function archiveProject(harness: MatrixHarness) {
  const result = await harness.request('http', {
    command: ['project', 'archive'],
    path: '/projects/alpha/archive',
    scope: 'alpha',
    method: 'POST',
    mutation: true,
    revision: 1,
    configRevision: 1,
    body: { affected_tasks: [{ task_id: harness.task.id, expected_revision: 1 }] },
  });
  expect(result.status).toBe(200);
  return z.object({ data: z.object({ revision: z.number() }) }).parse(result.envelope).data
    .revision;
}
async function prepareMutation(row: MatrixRow, harness: MatrixHarness, input: MatrixInvocation) {
  switch (row.command) {
    case 'project create':
      input.scope = 'gamma';
      input.path = '/projects/gamma';
      input.body = { slug: 'gamma', name: 'Создано из матрицы', emoji: '🌙' };
      delete input.configRevision;
      break;
    case 'project update':
      input.body = { name: 'Точное новое имя' };
      input.revision = 1;
      break;
    case 'project archive':
      input.revision = 1;
      input.body = { affected_tasks: [{ task_id: harness.task.id, expected_revision: 1 }] };
      break;
    case 'project restore':
      input.revision = await archiveProject(harness);
      input.body = { affected_tasks: [{ task_id: harness.task.id, expected_revision: 1 }] };
      break;
    case 'task create':
      input.body = {
        kind: 'ordinary',
        title: 'Новая задача',
        description: 'Точный **Markdown** 👩🏽‍💻\n',
        deadline: '2026-10-21T18:30:40.123Z',
      };
      break;
    case 'task update <task-id>':
      input.revision = 1;
      input.body = { description: 'Новый **исходник**\n', deadline: '2026-10-21T18:30:40.123Z' };
      break;
    case 'task transition <task-id>':
      input.revision = 1;
      input.body = {
        to_status_id: 'done',
        confirmation: { asserted: true, user_text: 'Проверил именно эту задачу 👩🏽‍💻' },
      };
      break;
    case 'task archive <task-id>':
      input.revision = 1;
      input.body = {};
      break;
    case 'task restore <task-id>': {
      const result = await harness.request('http', {
        command: ['task', 'archive', harness.task.id],
        path: `/projects/alpha/tasks/${harness.task.id}/archive`,
        scope: 'alpha',
        method: 'POST',
        mutation: true,
        revision: 1,
        configRevision: 1,
      });
      expect(result.status).toBe(200);
      input.revision = 2;
      input.body = { emoji_collision: 'reject' };
      break;
    }
    case 'dependency add <task-id>':
      input.revision = 1;
      input.body = {
        prerequisite_task_id: harness.prerequisite.id,
        prerequisite_project_slug: 'beta',
      };
      break;
    case 'dependency remove <task-id>': {
      const body = {
        prerequisite_task_id: harness.prerequisite.id,
        prerequisite_project_slug: 'beta',
      };
      const result = await harness.request('http', {
        command: ['dependency', 'add', harness.task.id],
        path: `/projects/alpha/tasks/${harness.task.id}/dependencies`,
        scope: 'alpha',
        method: 'POST',
        mutation: true,
        revision: 1,
        configRevision: 1,
        body,
      });
      expect(result.status).toBe(201);
      input.revision = 2;
      input.body = body;
      break;
    }
    case 'config migrate':
      input.revision = 1;
      input.body = {
        config: customConfig(),
        status_mappings: [],
        priority_mappings: [],
        affected_tasks: [],
      };
      break;
    default:
      throw new Error(`Missing ready mutation matrix preparation: ${row.command}`);
  }
}
export async function matrixInvocation(
  row: MatrixRow,
  harness: MatrixHarness,
): Promise<MatrixInvocation> {
  if (row.owner === 'US6')
    throw new Error(
      `Recovery row ${row.command} requires managed snapshot/job preparation in ${recoveryContractSuite}`,
    );
  const route = row.http[0];
  if (!route || route.method === 'PUT')
    throw new Error(`No ready request preparation: ${row.command}`);
  const target =
    row.kind === 'R' && /^(?:recurrence|occurrence) /u.test(row.command)
      ? await recurringReadTarget(harness)
      : { taskId: harness.task.id, occurrenceId: '' };
  const input: MatrixInvocation = {
    command: row.command
      .split(' ')
      .map((word) =>
        word === '<task-id>'
          ? target.taskId
          : word === '<occurrence-id>'
            ? target.occurrenceId
            : word,
      ),
    path: route.pattern
      .replace(':project_slug', 'alpha')
      .replace(':task_id', target.taskId)
      .replace(':occurrence_id', target.occurrenceId),
    method: route.method,
    scope: 'alpha',
  };
  if (row.kind === 'M') {
    input.mutation = true;
    input.configRevision = 1;
    await prepareMutation(row, harness, input);
  } else if (
    row.command === 'meta' ||
    row.command === 'project list' ||
    row.command === 'task list' ||
    row.command === 'config presets' ||
    row.command === 'audit list' ||
    row.command === 'settings get' ||
    row.command === 'agenda' ||
    row.command === 'priorities' ||
    row.command === 'stats'
  ) {
    delete input.scope;
    input.path += '?all_projects=true';
  } else if (row.command === 'config preview')
    input.body = {
      config: customConfig(),
      status_mappings: [],
      priority_mappings: [],
      affected_tasks: [],
    };
  else if (row.command === 'description preview')
    input.body = { description: '## Точный исходник\n<script>ignored</script>' };
  return input;
}
export async function matrixRequest(
  harness: MatrixHarness,
  transport: 'http' | 'cli',
  input: MatrixInvocation,
) {
  return harness.request(transport, input);
}
export function successfulData(envelope: unknown) {
  return responseEnvelopeSchema.parse(envelope);
}
