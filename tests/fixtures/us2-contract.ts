import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { z } from 'zod/mini';
import { createApp } from '../../src/api/app.js';
import { createLazyDataHelper } from './lazy-data-helper.js';
import { createContext } from '../../src/core/context.js';
import { createProject } from '../../src/core/projects/commands.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { getBuiltinPresets } from '../../src/core/projects/presets.js';
import { responseEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createDatabaseFixture } from './database.js';
import { createTestClock } from './clock.js';
export type Transport = 'http' | 'cli';
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const host = '127.0.0.1:3000';
export const taskIdentity = z.object({ id: z.uuid(), revision: z.number(), status_id: z.string() });
export function customConfig() {
  return {
    priority_model: { type: 'classic' as const },
    ordinary_workflow: {
      initial_status_id: 'todo',
      statuses: [
        { id: 'todo', label: 'Ожидает', category: 'not_started' as const, color: 'slate' as const },
        { id: 'done', label: 'Одобрено', category: 'completed' as const, color: 'green' as const },
      ],
      transitions: [
        { from: 'todo', to: 'done', requires_confirmation: true },
        { from: 'done', to: 'todo', requires_confirmation: false },
      ],
    },
    recurring_workflow: {
      ...getBuiltinPresets().recurring_workflow,
      statuses: getBuiltinPresets().recurring_workflow.statuses.map(({ id, label, category }) => ({
        id,
        label,
        category,
      })),
    },
  };
}
export async function createUs2Harness() {
  const fixture = await createDatabaseFixture(
    { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock },
    createTestClock(),
  );
  const epoch = z
    .object({ database_epoch: z.string() })
    .parse(
      fixture.connection.sqlite.prepare('SELECT database_epoch FROM application_state').get(),
    ).database_epoch;
  let app: ReturnType<typeof createApp>;
  try {
    app = createApp({ helper: createLazyDataHelper({ databasePath: fixture.path }) });
    await app.ready();
  } catch (error) {
    await fixture.close();
    throw error;
  }
  async function request(
    transport: Transport,
    input: {
      command: string[];
      path: string;
      method?: 'GET' | 'POST' | 'PATCH';
      scope?: string;
      body?: Record<string, JsonValue>;
      mutation?: boolean;
      revision?: number | undefined;
      configRevision?: number;
      operationId?: string | undefined;
      epoch?: string | undefined;
    },
  ) {
    const method = input.method ?? 'GET';
    const token = {
      operation_id: input.operationId ?? randomUUID(),
      database_epoch: input.epoch ?? epoch,
      ...(input.revision === undefined ? {} : { expected_revision: input.revision }),
      ...(input.configRevision === undefined
        ? {}
        : { expected_config_revision: input.configRevision }),
    };
    if (transport === 'http') {
      const response = await app.inject({
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
                ? { ...token, payload: input.body ?? {} }
                : (input.body ?? {}),
            }),
      });
      return {
        status: response.statusCode,
        envelope: responseEnvelopeSchema.parse(response.json()),
      };
    }
    const args = [
      ...input.command,
      ...(input.scope ? ['--project', input.scope] : ['--all-projects']),
      '--json',
    ];
    if (method !== 'GET') args.push('--input', '-');
    const response = spawnSync(process.execPath, [cli, ...args], {
      env: { ...process.env, AI_TASKS_DB_PATH: fixture.path },
      encoding: 'utf8',
      timeout: 5000,
      input: JSON.stringify(input.mutation ? { ...input.body, ...token } : (input.body ?? {})),
    });
    if (response.error) throw response.error;
    expect(response.signal).toBeNull();
    const output = response.status === 0 ? response.stdout : response.stderr;
    expect(output.split('\n')).toHaveLength(2);
    expect(response.status === 0 ? response.stderr : response.stdout).toBe('');
    return {
      status: response.status ?? 1,
      envelope: responseEnvelopeSchema.parse(JSON.parse(output)),
    };
  }
  const context = createContext({
    connection: fixture.connection,
    actor: 'human-web',
    now: Date.now,
  });
  async function project(slug = 'alpha', emoji = '🚀') {
    return successEnvelopeSchema.parse(
      createProject(context, slug, {
        operation_id: randomUUID(),
        database_epoch: epoch,
        payload: jsonValueSchema.parse({ slug, name: slug, emoji, config: customConfig() }),
      }),
    ).data;
  }
  async function task(slug = 'alpha', extra: Record<string, JsonValue> = {}) {
    return taskIdentity.parse(
      successEnvelopeSchema.parse(
        createTask(context, slug, {
          operation_id: randomUUID(),
          database_epoch: epoch,
          expected_config_revision: 1,
          payload: {
            kind: 'ordinary',
            title: 'Точный исходник',
            description: '**Не менять** 👩🏽‍💻\n',
            ...extra,
          },
        }),
      ).data,
    );
  }
  function snapshot() {
    return [
      'application_state',
      'projects',
      'project_configs',
      'tasks',
      'task_dependencies',
      'task_emoji_reservations',
      'audit_records',
      'operation_receipts',
    ].map((table) =>
      fixture.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  }
  return {
    fixture,
    app,
    epoch,
    request,
    project,
    task,
    snapshot,
    async close() {
      try {
        await app.close();
      } finally {
        await fixture.close();
      }
    },
  };
}
export function ok(
  result: {
    status: number;
    envelope: unknown;
  },
  transport: Transport,
  status = 200,
) {
  expect(result.status).toBe(transport === 'http' ? status : 0);
  return successEnvelopeSchema.parse(result.envelope);
}
export function failure(
  result: {
    status: number;
    envelope: unknown;
  },
  code: string,
  transport: Transport,
  status = 409,
) {
  const exitCode = code === 'TASK_NOT_FOUND' ? 3 : code === 'VALIDATION_ERROR' ? 2 : 4;
  expect(result.status).toBe(transport === 'http' ? status : exitCode);
  expect(result.envelope).toMatchObject({ ok: false, error: { code } });
}
