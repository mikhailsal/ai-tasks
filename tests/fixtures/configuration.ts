import { randomUUID } from 'node:crypto';
import { z } from 'zod/mini';
import { expect } from 'vitest';
import { createProject } from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { getTask } from '../../src/core/queries/tasks.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { taskDetailSchema, type TaskDetail } from '../../src/schema/tasks.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import type { ProjectConfigInput, PriorityValue } from '../../src/schema/configuration.js';
import { projectConfigInputSchema } from '../../src/schema/configuration.js';
import {
  successEnvelopeSchema,
  mutationSuccessEnvelopeSchema,
  type MutationEnvelope,
} from '../../src/schema/envelopes.js';
import type { CoreContext } from '../../src/core/database/types.js';
import { ordinaryInput, ordinarySnapshot, type OrdinaryFixture } from './ordinary-work.js';
export type StatusMapping = {
  kind: 'ordinary' | 'recurring';
  from_status_id: string;
  to_status_id: string;
};
export type MigrationPayload = {
  config: ProjectConfigInput;
  status_mappings: StatusMapping[];
  priority_mappings: {
    from: PriorityValue;
    to: PriorityValue;
  }[];
  affected_tasks: {
    task_id: string;
    expected_revision: number;
  }[];
};
export function migrationPayload(
  config: ProjectConfigInput,
  overrides: Partial<Omit<MigrationPayload, 'config'>> = {},
): MigrationPayload {
  return { config, status_mappings: [], priority_mappings: [], affected_tasks: [], ...overrides };
}
export function migrationInput(fixture: OrdinaryFixture, payload: MigrationPayload) {
  const project = z
    .object({ revision: z.number() })
    .parse(
      fixture.connection.sqlite
        .prepare("SELECT config_revision AS revision FROM projects WHERE slug = 'alpha'")
        .get(),
    );
  return ordinaryInput(fixture, jsonValueSchema.parse(payload), { revision: project.revision });
}
// Lazy imports keep the actual compiled CLI RED executable before T042 exists.
// Missing source exports remain pending and never count as behavioral RED.
export async function configurationApi() {
  const source = '../../src/core/projects/configuration.js';
  const loaded: unknown = await import(source);
  const commands = z
    .object({
      previewConfiguration: z.custom<
        (context: CoreContext, slug: string, payload: unknown) => unknown
      >((value) => typeof value === 'function'),
      migrateConfiguration: z.custom<
        (context: CoreContext, slug: string, input: MutationEnvelope) => unknown
      >((value) => typeof value === 'function'),
    })
    .parse(loaded);
  const previewSchema = z.extend(successEnvelopeSchema, {
    data: z.object({
      affected_tasks: z.array(z.object({ task_id: z.string(), expected_revision: z.number() })),
      required_status_mappings: z.array(
        z.object({ kind: z.enum(['ordinary', 'recurring']), from_status_id: z.string() }),
      ),
      required_priority_mappings: z.array(z.object({ from: jsonValueSchema })),
      issues: z.array(
        z.object({ code: z.string(), message: z.string(), task_id: z.optional(z.string()) }),
      ),
    }),
  });
  const resultSchema = z.extend(mutationSuccessEnvelopeSchema, {
    data: z.object({
      config: z.extend(projectConfigInputSchema, { revision: z.number() }),
      affected_tasks: z.array(z.object({ task_id: z.string(), revision: z.number() })),
    }),
  });
  return {
    previewConfiguration(context: CoreContext, slug: string, payload: unknown) {
      return previewSchema.parse(commands.previewConfiguration(context, slug, payload));
    },
    migrateConfiguration(context: CoreContext, slug: string, input: MutationEnvelope) {
      return resultSchema.parse(commands.migrateConfiguration(context, slug, input));
    },
  };
}
export function configurationSnapshot(fixture: OrdinaryFixture) {
  return {
    ...ordinarySnapshot(fixture),
    dependencies: fixture.connection.sqlite
      .prepare('SELECT * FROM task_dependencies ORDER BY dependent_task_id, prerequisite_task_id')
      .all(),
  };
}
/** Arrange persisted domain states through real create plus explicit SQLite fixture state.
 * This fixture targets migration, not the already-covered ordinary transition command. */
export function configurationTask(
  fixture: OrdinaryFixture,
  options: {
    status?: string;
    emoji?: string;
    priority?: PriorityValue;
    archived?: boolean;
    projectSlug?: string;
  } = {},
): TaskDetail {
  const slug = options.projectSlug ?? 'alpha';
  const result = createTask(
    fixture.human,
    slug,
    ordinaryInput(
      fixture,
      jsonValueSchema.parse({
        kind: 'ordinary',
        title: 'Настраиваемая задача',
        emoji: options.emoji ?? '⚪',
        priority: options.priority ?? null,
      }),
      { projectSlug: slug },
    ),
  );
  const task = taskDetailSchema.parse(result.data);
  const status = options.status ?? task.status_id;
  fixture.connection.sqlite
    .prepare('UPDATE tasks SET status_id = ?, archived_at = ? WHERE id = ?')
    .run(status, options.archived ? fixture.clock.now() : null, task.id);
  if (options.archived || ['done', 'cancelled'].includes(status))
    fixture.connection.sqlite
      .prepare('DELETE FROM task_emoji_reservations WHERE task_id = ?')
      .run(task.id);
  return {
    ...task,
    status_id: status,
    archived_at: options.archived ? new Date(fixture.clock.now()).toISOString() : null,
  };
}
export function seedConfigurationDependency(
  fixture: OrdinaryFixture,
  dependent: TaskDetail,
  prerequisite: TaskDetail,
): void {
  fixture.connection.sqlite
    .prepare(
      `INSERT INTO task_dependencies
    (dependent_task_id,dependent_project_slug,prerequisite_task_id,prerequisite_project_slug,created_at,created_operation_id)
    VALUES (?,?,?,?,?,?)`,
    )
    .run(
      dependent.id,
      dependent.project_slug,
      prerequisite.id,
      prerequisite.project_slug,
      fixture.clock.now(),
      randomUUID(),
    );
}
export function taskRows(fixture: OrdinaryFixture) {
  return z
    .array(
      z.object({
        id: z.string(),
        status_id: z.string(),
        priority: z.nullable(z.string()),
        revision: z.number(),
        updated_at: z.number(),
        archived_at: z.nullable(z.number()),
      }),
    )
    .parse(
      fixture.connection.sqlite
        .prepare(
          'SELECT id,status_id,priority,revision,updated_at,archived_at FROM tasks ORDER BY id',
        )
        .all(),
    );
}
export function invalidConfigurations(): JsonValue[] {
  const config = createDefaultProjectConfig();
  return z.array(jsonValueSchema).parse([
    { ...config, priority_model: { type: 'numeric', min: 1, max: 1, direction: 'higher' } },
    {
      ...config,
      priority_model: { type: 'numeric', min: 0, max: 1000000001, direction: 'higher' },
    },
    { ...config, priority_model: { type: 'numeric', min: 0.0001, max: 1, direction: 'higher' } },
    {
      ...config,
      priority_model: {
        type: 'named',
        levels: Array.from({ length: 101 }, (_, i) => ({ id: `n${i}`, label: 'Уровень' })),
      },
    },
    {
      ...config,
      priority_model: {
        type: 'named',
        levels: [
          { id: 'a', label: 'A' },
          { id: 'a', label: 'B' },
        ],
      },
    },
    { ...config, ordinary_workflow: { ...config.ordinary_workflow, initial_status_id: 'done' } },
    {
      ...config,
      recurring_workflow: { ...config.recurring_workflow, restore_status_id: 'active' },
    },
    {
      ...config,
      ordinary_workflow: {
        ...config.ordinary_workflow,
        statuses: [...config.ordinary_workflow.statuses, config.ordinary_workflow.statuses[0]],
      },
    },
    {
      ...config,
      ordinary_workflow: {
        ...config.ordinary_workflow,
        transitions: [{ from: 'idea', to: 'absent', requires_confirmation: false }],
      },
    },
    {
      ...config,
      ordinary_workflow: {
        ...config.ordinary_workflow,
        transitions: [{ from: 'idea', to: 'done' }],
      },
    },
    {
      ...config,
      ordinary_workflow: {
        ...config.ordinary_workflow,
        statuses: [{ id: 'idea', label: 'Идея', category: 'not_started', color: 'pink' }],
      },
    },
    {
      ...config,
      ordinary_workflow: {
        ...config.ordinary_workflow,
        statuses: Array.from({ length: 101 }, (_, i) => ({
          id: i === 0 ? 'idea' : `s${i}`,
          label: 'Статус',
          category: 'not_started',
        })),
      },
    },
  ]);
}
export async function assertAdvancedProjection(
  fixture: OrdinaryFixture,
  mode: 'category' | 'status' | 'completed-together' | 'priority-only',
) {
  const api = await configurationApi();
  const prerequisite = configurationTask(fixture);
  const advanced = mode === 'status' || mode === 'priority-only';
  const dependent = configurationTask(fixture, {
    status: advanced ? 'in_progress' : 'ready',
    priority: { model: 'classic', level: 'high' },
  });
  seedConfigurationDependency(fixture, dependent, prerequisite);
  const config = createDefaultProjectConfig();
  const proposal = migrationPayload(config, {
    affected_tasks: [{ task_id: dependent.id, expected_revision: 1 }],
  });
  if (mode === 'category') {
    config.ordinary_workflow.statuses = config.ordinary_workflow.statuses.map((status) =>
      status.id === 'ready' ? { ...status, category: 'in_progress' } : status,
    );
    proposal.status_mappings = [
      { kind: 'ordinary', from_status_id: 'ready', to_status_id: 'ready' },
    ];
  } else if (mode === 'status') {
    config.ordinary_workflow.statuses.push({
      id: 'working2',
      label: 'Другая работа',
      category: 'in_progress',
    });
    proposal.status_mappings = [
      { kind: 'ordinary', from_status_id: 'in_progress', to_status_id: 'working2' },
    ];
  } else if (mode === 'completed-together') {
    proposal.status_mappings = [
      { kind: 'ordinary', from_status_id: 'idea', to_status_id: 'done' },
      { kind: 'ordinary', from_status_id: 'ready', to_status_id: 'in_progress' },
    ];
    proposal.affected_tasks.push({ task_id: prerequisite.id, expected_revision: 1 });
  } else {
    proposal.priority_mappings = [
      { from: { model: 'classic', level: 'high' }, to: { model: 'classic', level: 'low' } },
    ];
  }
  const before = configurationSnapshot(fixture);
  const preview = api.previewConfiguration(fixture.human, 'alpha', proposal);
  expect(configurationSnapshot(fixture)).toEqual(before);
  if (mode === 'category' || mode === 'status') {
    expect(preview.data.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DEPENDENCY_BLOCKED' })]),
    );
    expect(() =>
      api.migrateConfiguration(fixture.human, 'alpha', migrationInput(fixture, proposal)),
    ).toThrowError(expect.objectContaining({ code: 'DEPENDENCY_BLOCKED' }));
    expect(configurationSnapshot(fixture)).toEqual(before);
    return;
  }
  expect(preview.data.issues).toEqual([]);
  api.migrateConfiguration(fixture.human, 'alpha', migrationInput(fixture, proposal));
  expect(getTask(fixture.human, 'alpha', dependent.id).data).toMatchObject({
    revision: 2,
    status_id: 'in_progress',
    blocked: mode === 'priority-only',
  });
  if (mode === 'completed-together')
    expect(getTask(fixture.human, 'alpha', prerequisite.id).data.category).toBe('completed');
}
export async function assertCrossProjectProjection(fixture: OrdinaryFixture) {
  const api = await configurationApi();
  const prerequisite = configurationTask(fixture, { status: 'done' });
  createProject(
    fixture.human,
    'beta',
    ordinaryInput(fixture, { slug: 'beta', name: 'Бета', emoji: '🌲' }, { projectSlug: 'beta' }),
  );
  const dependent = configurationTask(fixture, { projectSlug: 'beta', status: 'in_progress' });
  seedConfigurationDependency(fixture, dependent, prerequisite);
  const oldDependent = fixture.connection.sqlite
    .prepare('SELECT * FROM tasks WHERE id = ?')
    .get(dependent.id);
  const proposal = migrationPayload(createDefaultProjectConfig(), {
    status_mappings: [{ kind: 'ordinary', from_status_id: 'done', to_status_id: 'idea' }],
    affected_tasks: [{ task_id: prerequisite.id, expected_revision: 1 }],
  });
  expect(api.previewConfiguration(fixture.human, 'alpha', proposal).data.issues).toEqual([]);
  api.migrateConfiguration(fixture.human, 'alpha', migrationInput(fixture, proposal));
  expect(
    fixture.connection.sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(dependent.id),
  ).toEqual(oldDependent);
  expect(getTask(fixture.human, 'beta', dependent.id).data).toMatchObject({
    blocked: true,
    status_id: 'in_progress',
    revision: 1,
  });
}
export async function assertEmojiProjection(
  fixture: OrdinaryFixture,
  mode: 'occupied' | 'two-returning' | 'release-before-acquire',
) {
  const api = await configurationApi();
  const terminal = configurationTask(fixture, { status: 'done', emoji: '🧪' });
  const other = configurationTask(fixture, {
    status: mode === 'two-returning' ? 'done' : 'idea',
    emoji: '🧪',
  });
  const proposal = migrationPayload(createDefaultProjectConfig(), {
    status_mappings: [{ kind: 'ordinary', from_status_id: 'done', to_status_id: 'idea' }],
    affected_tasks: [{ task_id: terminal.id, expected_revision: 1 }],
  });
  if (mode === 'two-returning')
    proposal.affected_tasks.push({ task_id: other.id, expected_revision: 1 });
  if (mode === 'release-before-acquire') {
    proposal.status_mappings.push({
      kind: 'ordinary',
      from_status_id: 'idea',
      to_status_id: 'done',
    });
    proposal.affected_tasks.push({ task_id: other.id, expected_revision: 1 });
  }
  const before = configurationSnapshot(fixture);
  const preview = api.previewConfiguration(fixture.human, 'alpha', proposal);
  expect(configurationSnapshot(fixture)).toEqual(before);
  if (mode !== 'release-before-acquire') {
    expect(preview.data.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'EMOJI_CONFLICT' })]),
    );
    expect(() =>
      api.migrateConfiguration(fixture.human, 'alpha', migrationInput(fixture, proposal)),
    ).toThrowError(expect.objectContaining({ code: 'EMOJI_CONFLICT' }));
    expect(configurationSnapshot(fixture)).toEqual(before);
    return;
  }
  expect(preview.data.issues).toEqual([]);
  api.migrateConfiguration(fixture.human, 'alpha', migrationInput(fixture, proposal));
  expect(
    fixture.connection.sqlite
      .prepare('SELECT task_id,emoji_key FROM task_emoji_reservations WHERE project_slug = ?')
      .all('alpha'),
  ).toEqual([{ task_id: terminal.id, emoji_key: '🧪' }]);
  expect(getTask(fixture.human, 'alpha', terminal.id).data.emoji).toBe('🧪');
  expect(getTask(fixture.human, 'alpha', other.id).data).toMatchObject({
    category: 'completed',
    emoji: '🧪',
  });
}
