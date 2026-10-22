import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { z } from 'zod/mini';
import { createContext } from '../../src/core/context.js';
import { createProject } from '../../src/core/projects/commands.js';
import { responseEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import { createUs2Harness, customConfig, type Transport } from './us2-contract.js';
export type RecurrenceRequest = {
  command: string[];
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  scope?: string;
  body?: Record<string, JsonValue>;
  mutation?: boolean;
  revision?: number;
  configRevision?: number;
  settingsRevision?: number;
  operationId?: string;
  epoch?: string;
  extraArgs?: string[];
};
export const recurringIdentity = z.object({
  id: z.uuid(),
  revision: z.int().check(z.positive()),
  status_id: z.string(),
  kind: z.literal('recurring'),
});
export function futureRecurrence(overrides: Record<string, JsonValue> = {}) {
  return {
    first_deadline: new Date(Date.now() + 86400000).toISOString(),
    schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '09:00:00.000' },
    miss_policy: 'carry_forward',
    confirmation_window_ms: 0,
    ...overrides,
  };
}
function requestGuards(input: RecurrenceRequest, epoch: string) {
  return {
    operation_id: input.operationId ?? randomUUID(),
    database_epoch: input.epoch ?? epoch,
    ...(input.revision === undefined ? {} : { expected_revision: input.revision }),
    ...(input.configRevision === undefined
      ? {}
      : { expected_config_revision: input.configRevision }),
    ...(input.settingsRevision === undefined
      ? {}
      : { expected_settings_revision: input.settingsRevision }),
  };
}
export async function createRecurrenceHarness(
  options: {
    restoreConfirmation?: boolean;
  } = {},
) {
  const base = await createUs2Harness();
  const host = '127.0.0.1:3000';
  async function request(transport: Transport, input: RecurrenceRequest) {
    const method = input.method ?? 'GET';
    const guards = requestGuards(input, base.epoch);
    if (transport === 'http') {
      const result = await base.app.inject({
        method,
        url: `/api/v1${input.path}`,
        headers: {
          host,
          origin: `http://${host}`,
          'content-type': 'application/json',
          'x-ai-tasks-mutation': '1',
        },
        ...(method === 'GET'
          ? {}
          : {
              payload: input.mutation
                ? { ...guards, payload: input.body ?? {} }
                : (input.body ?? {}),
            }),
      });
      return {
        status: result.statusCode,
        envelope: responseEnvelopeSchema.parse(result.json()),
      };
    }
    const args = [
      'dist/cli.js',
      ...input.command,
      ...(input.scope ? ['--project', input.scope] : ['--all-projects']),
      '--json',
      ...(input.extraArgs ?? []),
      ...(input.body !== undefined || input.mutation ? ['--input', '-'] : []),
    ];
    const result = spawnSync(process.execPath, args, {
      env: { ...process.env, AI_TASKS_DB_PATH: base.fixture.path },
      encoding: 'utf8',
      timeout: 8000,
      input: JSON.stringify(input.mutation ? { ...input.body, ...guards } : (input.body ?? {})),
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    const output = result.status === 0 ? result.stdout : result.stderr;
    expect(result.status === 0 ? result.stderr : result.stdout).toBe('');
    expect(output.endsWith('\n')).toBe(true);
    expect(output.trimEnd().split('\n')).toHaveLength(1);
    return {
      status: result.status ?? 1,
      envelope: responseEnvelopeSchema.parse(JSON.parse(output)),
    };
  }
  function snapshot() {
    return [
      'application_state',
      'projects',
      'project_configs',
      'tasks',
      'schedule_generations',
      'recurrence_state',
      'recurrence_intervals',
      'occurrences',
      'task_dependencies',
      'project_emoji_reservations',
      'task_emoji_reservations',
      'audit_records',
      'operation_receipts',
    ].map((table) =>
      base.fixture.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  }
  function task(id: string) {
    return z
      .object({ id: z.uuid(), revision: z.number(), status_id: z.string() })
      .parse(base.fixture.connection.sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(id));
  }
  function occurrences(id: string) {
    return z
      .array(
        z.object({
          id: z.uuid(),
          revision: z.number(),
          state: z.string(),
          deadline: z.number(),
          description_snapshot: z.string(),
          schedule_snapshot: z.string(),
        }),
      )
      .parse(
        base.fixture.connection.sqlite
          .prepare('SELECT * FROM occurrences WHERE task_id=? ORDER BY deadline,id')
          .all(id),
      );
  }
  async function create(transport: Transport, extra: Record<string, JsonValue> = {}) {
    const result = await request(transport, {
      command: ['task', 'create'],
      path: '/projects/alpha/tasks',
      scope: 'alpha',
      method: 'POST',
      mutation: true,
      configRevision: 1,
      settingsRevision: 1,
      body: {
        kind: 'recurring',
        title: 'Повторяющаяся работа',
        description: '  **Исходник** 👩🏽‍💻\n',
        recurrence: futureRecurrence(),
        ...extra,
      },
    });
    expect(result.status).toBe(transport === 'http' ? 201 : 0);
    return recurringIdentity.parse(successEnvelopeSchema.parse(result.envelope).data);
  }
  function controlInput(
    id: string,
    status: string,
    body: Record<string, JsonValue> = {},
  ): RecurrenceRequest {
    return {
      command: ['recurrence', 'control', id],
      path: `/projects/alpha/tasks/${id}/recurrence/control`,
      scope: 'alpha',
      method: 'POST',
      mutation: true,
      revision: task(id).revision,
      configRevision: 1,
      settingsRevision: 1,
      body: { to_status_id: status, ...body },
    };
  }
  async function activate(id: string) {
    const result = await request('http', controlInput(id, 'active'));
    expect(result.status).toBe(200);
    expect(occurrences(id).length).toBeGreaterThan(0);
    return task(id);
  }
  async function archivedOrdinary() {
    const parent = await base.task();
    const archived = await request('http', {
      command: ['task', 'archive', parent.id],
      path: `/projects/alpha/tasks/${parent.id}/archive`,
      scope: 'alpha',
      method: 'POST',
      mutation: true,
      revision: 1,
      configRevision: 1,
      body: {},
    });
    expect(archived.status).toBe(200);
    return task(parent.id);
  }
  try {
    for (const [slug, emoji] of [
      ['alpha', '🔵'],
      ['beta', '🟢'],
    ] as const) {
      const config = customConfig();
      if (options.restoreConfirmation) {
        config.recurring_workflow.transitions = config.recurring_workflow.transitions.map(
          (edge) => ({
            ...edge,
            requires_confirmation:
              edge.from === 'archived' && edge.to === 'paused' ? true : edge.requires_confirmation,
          }),
        );
      }
      const context = createContext({
        connection: base.fixture.connection,
        actor: 'human-web',
        now: Date.now,
      });
      const created = createProject(context, slug, {
        operation_id: randomUUID(),
        database_epoch: base.epoch,
        payload: jsonValueSchema.parse({ slug, name: slug, emoji, config }),
      });
      expect(successEnvelopeSchema.parse(created).ok).toBe(true);
    }
    return {
      ...base,
      request,
      snapshot,
      task,
      occurrences,
      create,
      activate,
      controlInput,
      archivedOrdinary,
    };
  } catch (error) {
    await base.close();
    throw error;
  }
}
export type RecurrenceHarness = Awaited<ReturnType<typeof createRecurrenceHarness>>;
export function recurrenceSuccess(
  result: Awaited<ReturnType<RecurrenceHarness['request']>>,
  transport: Transport,
  status = 200,
) {
  expect(result.status).toBe(transport === 'cli' ? 0 : status);
  return successEnvelopeSchema.parse(result.envelope);
}
