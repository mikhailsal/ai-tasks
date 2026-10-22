import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonValue } from '../../src/schema/values.js';
import {
  createUs2Harness,
  customConfig,
  failure,
  ok,
  type Transport,
} from '../fixtures/us2-contract.js';

let harness: Awaited<ReturnType<typeof createUs2Harness>>;
beforeEach(async () => {
  harness = await createUs2Harness();
});
afterEach(async () => {
  await harness?.close();
});

type Migration = {
  config: JsonValue;
  status_mappings: JsonValue[];
  priority_mappings: JsonValue[];
  affected_tasks: { task_id: string; expected_revision: number }[];
};
function proposal(tasks: { id: string; revision: number }[] = []): Migration {
  return {
    config: customConfig(),
    status_mappings: [],
    priority_mappings: [],
    affected_tasks: tasks.map((task) => ({ task_id: task.id, expected_revision: task.revision })),
  };
}
function configuration(
  transport: Transport,
  body: Migration,
  options: {
    preview?: boolean;
    operationId?: string;
    configRevision?: number;
    slug?: string;
    epoch?: string;
  } = {},
) {
  const mode = options.preview ? 'preview' : 'migrate';
  const slug = options.slug ?? 'alpha';
  return harness.request(transport, {
    command: ['config', mode],
    path: `/projects/${slug}/config/${mode}`,
    scope: slug,
    method: 'POST',
    body,
    mutation: !options.preview,
    configRevision: options.configRevision ?? 1,
    revision: options.configRevision ?? 1,
    operationId: options.operationId,
    epoch: options.epoch,
  });
}
function dependency(
  transport: Transport,
  id: string,
  options: {
    mode: 'list' | 'add' | 'remove';
    slug?: string;
    targetId?: string;
    targetSlug?: string;
    revision?: number;
    operationId?: string;
    configRevision?: number;
  },
) {
  const slug = options.slug ?? 'alpha';
  return harness.request(transport, {
    command: ['dependency', options.mode, id],
    scope: slug,
    path: `/projects/${slug}/tasks/${id}/dependencies${options.mode === 'remove' ? '/remove' : ''}`,
    method: options.mode === 'list' ? 'GET' : 'POST',
    mutation: options.mode !== 'list',
    revision: options.revision,
    configRevision: options.configRevision ?? 1,
    operationId: options.operationId,
    body:
      options.mode === 'list'
        ? {}
        : {
            prerequisite_task_id: options.targetId ?? id,
            prerequisite_project_slug: options.targetSlug ?? slug,
          },
  });
}
function priorityVariant(draft: Migration, variant: string) {
  if (!variant.includes('priority')) return;
  const initial = customConfig();
  draft.config = {
    ...initial,
    priority_model: { type: 'named', levels: [{ id: 'first', label: 'Первая очередь' }] },
  };
  draft.status_mappings = [];
  const mapping = {
    from: {
      model: 'classic',
      level: variant === 'unknown priority mapping' ? 'low' : 'high',
    },
    to: {
      model: 'named',
      level_id: variant === 'invalid priority mapping' ? 'absent' : 'first',
    },
  };
  draft.priority_mappings =
    variant === 'missing priority mapping'
      ? []
      : variant === 'duplicate priority mapping'
        ? [mapping, mapping]
        : [mapping];
}
function taskRead(id: string) {
  return harness.request('http', {
    command: ['task', 'get', id],
    scope: 'alpha',
    path: `/projects/alpha/tasks/${id}`,
  });
}

describe.each(['http', 'cli'] as const)('%s US2 configuration contract', (transport) => {
  it('returns pure presets/current config and a real side-effect-free migration preview', async () => {
    await harness.project();
    await harness.task();
    const before = harness.snapshot();
    const presets = ok(
      await harness.request(transport, {
        command: ['config', 'presets'],
        path: '/config/presets?all_projects=true',
      }),
      transport,
    );
    expect(presets.data).toMatchObject({
      priority_models: expect.arrayContaining([{ type: 'classic' }, { type: 'eisenhower' }]),
    });
    const read = ok(
      await harness.request(transport, {
        command: ['config', 'get'],
        scope: 'alpha',
        path: '/projects/alpha/config',
      }),
      transport,
    );
    expect(read.data).toMatchObject({ revision: 1, ...customConfig() });
    const preview = ok(await configuration(transport, proposal(), { preview: true }), transport);
    expect(preview.data).toEqual({
      affected_tasks: [],
      required_status_mappings: [],
      required_priority_mappings: [],
      issues: [],
    });
    expect(harness.snapshot()).toEqual(before);
  });

  it('reports exact required status/priority mappings including archived tasks without committing', async () => {
    await harness.project();
    const task = await harness.task('alpha', { priority: { model: 'classic', level: 'high' } });
    const archived = await harness.task();
    ok(
      await harness.request('http', {
        command: ['task', 'archive', archived.id],
        scope: 'alpha',
        path: `/projects/alpha/tasks/${archived.id}/archive`,
        method: 'POST',
        mutation: true,
        revision: 1,
        configRevision: 1,
      }),
      'http',
    );
    const draft = proposal([{ ...archived, revision: 2 }, task]);
    const config = customConfig();
    draft.config = {
      ...config,
      priority_model: { type: 'named', levels: [{ id: 'p1', label: 'Очень важно', color: 'red' }] },
      ordinary_workflow: {
        ...config.ordinary_workflow,
        initial_status_id: 'queued',
        statuses: config.ordinary_workflow.statuses.map((status) =>
          status.id === 'todo' ? { ...status, id: 'queued' } : status,
        ),
        transitions: config.ordinary_workflow.transitions.map((edge) => ({
          ...edge,
          from: edge.from === 'todo' ? 'queued' : edge.from,
          to: edge.to === 'todo' ? 'queued' : edge.to,
        })),
      },
    };
    const before = harness.snapshot();
    const result = ok(await configuration(transport, draft, { preview: true }), transport);
    expect(result.data).toMatchObject({
      affected_tasks: expect.arrayContaining([
        { task_id: task.id, expected_revision: 1 },
        { task_id: archived.id, expected_revision: 2 },
      ]),
      required_status_mappings: [{ kind: 'ordinary', from_status_id: 'todo' }],
      required_priority_mappings: [{ from: { model: 'classic', level: 'high' } }],
    });
    expect(harness.snapshot()).toEqual(before);
  });

  it('commits one atomic config revision, preserves source and replay envelope, and rejects changed-ID reuse', async () => {
    await harness.project();
    const task = await harness.task();
    const draft = proposal();
    const config = customConfig();
    draft.config = {
      ...config,
      ordinary_workflow: {
        ...config.ordinary_workflow,
        statuses: config.ordinary_workflow.statuses.map((status) => ({
          ...status,
          label: `Новое имя ${status.label}`,
        })),
      },
    };
    const operationId = randomUUID();
    const first = ok(await configuration(transport, draft, { operationId }), transport);
    expect(first.data).toMatchObject({ config: { revision: 2 }, affected_tasks: [] });
    const after = harness.snapshot();
    expect(ok(await configuration(transport, draft, { operationId }), transport)).toEqual(first);
    expect(harness.snapshot()).toEqual(after);
    const stored = ok(await taskRead(task.id), 'http');
    expect(stored.data).toMatchObject({
      revision: 1,
      status_id: 'todo',
      description: '**Не менять** 👩🏽‍💻\n',
      config_revision: 2,
    });
    failure(
      await configuration(
        transport,
        {
          ...draft,
          status_mappings: [{ kind: 'ordinary', from_status_id: 'todo', to_status_id: 'done' }],
        },
        { operationId },
      ),
      'IDEMPOTENCY_CONFLICT',
      transport,
    );
    expect(harness.snapshot()).toEqual(after);
    const receipts = harness.fixture.connection.sqlite
      .prepare('SELECT actor FROM operation_receipts WHERE operation_id=?')
      .all(operationId);
    expect(receipts).toEqual([{ actor: transport === 'http' ? 'human-web' : 'ai-cli:alpha' }]);
  });

  it.each([
    'missing member',
    'duplicate member',
    'unknown member',
    'stale member',
    'stale config',
    'missing mapping',
    'duplicate mapping',
    'unknown mapping',
    'invalid target',
    'missing priority mapping',
    'duplicate priority mapping',
    'unknown priority mapping',
    'invalid priority mapping',
  ])(
    'rejects %s atomically with no receipt, audit, revision, or source changes',
    async (variant) => {
      await harness.project();
      const task = await harness.task(
        'alpha',
        variant.includes('priority') ? { priority: { model: 'classic', level: 'high' } } : {},
      );
      const draft = proposal([task]);
      const initial = customConfig();
      draft.config = {
        ...initial,
        ordinary_workflow: {
          initial_status_id: 'queued',
          statuses: [
            { id: 'queued', label: 'Очередь', category: 'not_started' },
            { id: 'done', label: 'Одобрено', category: 'completed' },
          ],
          transitions: [],
        },
      };
      draft.status_mappings = [
        { kind: 'ordinary', from_status_id: 'todo', to_status_id: 'queued' },
      ];
      let configRevision = 1;
      if (variant === 'missing member') draft.affected_tasks = [];
      if (variant === 'duplicate member')
        draft.affected_tasks.push({ task_id: task.id, expected_revision: 1 });
      if (variant === 'unknown member')
        draft.affected_tasks.push({ task_id: randomUUID(), expected_revision: 1 });
      if (variant === 'stale member')
        draft.affected_tasks = [{ task_id: task.id, expected_revision: 9 }];
      if (variant === 'stale config') configRevision = 9;
      if (
        (variant.includes('mapping') && !variant.includes('priority')) ||
        variant === 'invalid target'
      ) {
        const config = customConfig();
        // Supply a valid proposed workflow so failure is the mapping contract, not an invalid initial category.
        draft.config = {
          ...config,
          ordinary_workflow: {
            initial_status_id: 'fresh',
            statuses: [
              { id: 'fresh', label: 'Новая', category: 'not_started' },
              ...config.ordinary_workflow.statuses.map((status) =>
                status.id === 'todo' ? { ...status, category: 'in_progress' } : status,
              ),
            ],
            transitions: [],
          },
        };
        const mapping = {
          kind: 'ordinary',
          from_status_id: 'todo',
          to_status_id: variant === 'invalid target' ? 'absent' : 'fresh',
        };
        draft.status_mappings =
          variant === 'missing mapping'
            ? []
            : variant === 'duplicate mapping'
              ? [mapping, mapping]
              : variant === 'unknown mapping'
                ? [{ ...mapping, from_status_id: 'unused' }]
                : [mapping];
      }
      priorityVariant(draft, variant);
      const before = harness.snapshot();
      const code =
        variant === 'unknown member'
          ? 'TASK_NOT_FOUND'
          : variant === 'stale member'
            ? 'REVISION_CONFLICT'
            : variant === 'stale config'
              ? 'CONFIG_CONFLICT'
              : 'VALIDATION_ERROR';
      failure(
        await configuration(transport, draft, { configRevision }),
        code,
        transport,
        code === 'TASK_NOT_FOUND' ? 404 : code === 'VALIDATION_ERROR' ? 400 : 409,
      );
      expect(harness.snapshot()).toEqual(before);
    },
  );
});

describe.each(['http', 'cli'] as const)('%s US2 dependency contract', (transport) => {
  it('adds/lists/removes explicit cross-project links, auditing the parent once and replaying exactly', async () => {
    await harness.project();
    await harness.project('beta', '🌲');
    const parent = await harness.task();
    const target = await harness.task('beta');
    const operationId = randomUUID();
    const options = {
      mode: 'add' as const,
      targetId: target.id,
      targetSlug: 'beta',
      revision: 1,
      operationId,
    };
    const added = ok(await dependency(transport, parent.id, options), transport, 201);
    expect(added.data).toMatchObject({
      id: parent.id,
      revision: 2,
      blocked: true,
      dependencies: [
        {
          task_id: parent.id,
          prerequisite_task_id: target.id,
          prerequisite_project_slug: 'beta',
          satisfied: false,
        },
      ],
    });
    const after = harness.snapshot();
    expect(ok(await dependency(transport, parent.id, options), transport, 201)).toEqual(added);
    expect(harness.snapshot()).toEqual(after);
    const list = ok(await dependency(transport, parent.id, { mode: 'list' }), transport);
    expect(list.data).toEqual([
      {
        task_id: parent.id,
        prerequisite_task_id: target.id,
        prerequisite_project_slug: 'beta',
        satisfied: false,
      },
    ]);
    expect(harness.snapshot()).toEqual(after);
    const removed = ok(
      await dependency(transport, parent.id, {
        mode: 'remove',
        targetId: target.id,
        targetSlug: 'beta',
        revision: 2,
      }),
      transport,
    );
    expect(removed.data).toMatchObject({
      revision: 3,
      status_id: 'todo',
      blocked: false,
      dependencies: [],
      description: '**Не менять** 👩🏽‍💻\n',
    });
  });

  it.each(['wrong source', 'wrong target', 'self', 'stale parent', 'stale config'])(
    'rejects dependency %s without partial graph or audit changes',
    async (variant) => {
      await harness.project();
      await harness.project('beta', '🌲');
      const parent = await harness.task();
      const target = await harness.task('beta');
      const options = {
        mode: 'add' as const,
        targetId: target.id,
        targetSlug: 'beta',
        revision: 1,
        slug: 'alpha',
        configRevision: 1,
      };
      if (variant === 'wrong source') options.slug = 'beta';
      if (variant === 'wrong target') options.targetSlug = 'alpha';
      if (variant === 'self') {
        options.targetId = parent.id;
        options.targetSlug = 'alpha';
      }
      if (variant === 'stale parent') options.revision = 9;
      if (variant === 'stale config') options.configRevision = 9;
      const before = harness.snapshot();
      const code = variant.startsWith('wrong')
        ? 'PROJECT_MISMATCH'
        : variant === 'self'
          ? 'VALIDATION_ERROR'
          : variant === 'stale parent'
            ? 'REVISION_CONFLICT'
            : 'CONFIG_CONFLICT';
      failure(
        await dependency(transport, parent.id, options),
        code,
        transport,
        code === 'VALIDATION_ERROR' ? 400 : 409,
      );
      expect(harness.snapshot()).toEqual(before);
    },
  );
});

describe.each(['http', 'cli'] as const)('%s US2 atomic migration outcomes', (transport) => {
  it('maps every archived and active task exactly once with preserved raw Markdown and one config receipt', async () => {
    await harness.project();
    const active = await harness.task('alpha', { priority: { model: 'classic', level: 'high' } });
    const archived = await harness.task();
    ok(
      await harness.request('http', {
        command: ['task', 'archive', archived.id],
        scope: 'alpha',
        path: `/projects/alpha/tasks/${archived.id}/archive`,
        method: 'POST',
        mutation: true,
        revision: 1,
        configRevision: 1,
      }),
      'http',
    );
    const old = customConfig();
    const draft = proposal([active, { ...archived, revision: 2 }]);
    draft.config = {
      ...old,
      priority_model: { type: 'numeric', min: 0, max: 10, direction: 'higher' },
      ordinary_workflow: {
        initial_status_id: 'queued',
        statuses: [
          { id: 'queued', label: 'Очередь', category: 'not_started' },
          old.ordinary_workflow.statuses[1] ?? {
            id: 'done',
            label: 'Одобрено',
            category: 'completed',
          },
        ],
        transitions: [],
      },
    };
    draft.status_mappings = [{ kind: 'ordinary', from_status_id: 'todo', to_status_id: 'queued' }];
    draft.priority_mappings = [
      { from: { model: 'classic', level: 'high' }, to: { model: 'numeric', value: 9.875 } },
    ];
    const result = ok(await configuration(transport, draft), transport);
    expect(result.data).toMatchObject({
      config: { revision: 2 },
      affected_tasks: expect.arrayContaining([
        { task_id: active.id, revision: 2 },
        { task_id: archived.id, revision: 3 },
      ]),
    });
    const current = ok(await taskRead(active.id), 'http');
    expect(current.data).toMatchObject({
      status_id: 'queued',
      priority: { model: 'numeric', value: 9.875 },
      description: '**Не менять** 👩🏽‍💻\n',
    });
    expect(ok(await taskRead(archived.id), 'http').data).toMatchObject({
      status_id: 'queued',
      revision: 3,
      archived_at: expect.any(String),
    });
  });

  it('rejects projected emoji collisions atomically instead of silently changing a mapped task marker', async () => {
    await harness.project();
    const old = await harness.task('alpha', { emoji: '🧪' });
    ok(
      await harness.request('http', {
        command: ['task', 'transition', old.id],
        scope: 'alpha',
        path: `/projects/alpha/tasks/${old.id}/transitions`,
        method: 'POST',
        mutation: true,
        revision: 1,
        configRevision: 1,
        body: { to_status_id: 'done', confirmation: { asserted: true, user_text: 'Проверено' } },
      }),
      'http',
    );
    await harness.task('alpha', { emoji: '🧪' });
    const draft = proposal([{ ...old, revision: 2 }]);
    const config = customConfig();
    draft.config = {
      ...config,
      ordinary_workflow: {
        initial_status_id: 'todo',
        statuses: [{ id: 'todo', label: 'Снова в работе', category: 'not_started' }],
        transitions: [],
      },
    };
    draft.status_mappings = [{ kind: 'ordinary', from_status_id: 'done', to_status_id: 'todo' }];
    const before = harness.snapshot();
    failure(await configuration(transport, draft), 'EMOJI_CONFLICT', transport);
    expect(harness.snapshot()).toEqual(before);
  });

  it('requires the explicit current epoch before looking up a migration replay', async () => {
    await harness.project();
    const operationId = randomUUID();
    const draft = proposal();
    ok(await configuration(transport, draft, { operationId }), transport);
    const before = harness.snapshot();
    failure(
      await configuration(transport, draft, { operationId, epoch: randomUUID() }),
      'DATABASE_EPOCH_CONFLICT',
      transport,
    );
    expect(harness.snapshot()).toEqual(before);
  });
});

describe.each(['http', 'cli'] as const)(
  '%s US2 dependency transition and cycle outcomes',
  (transport) => {
    it('blocks even confirmed completion until every selected prerequisite is completed', async () => {
      await harness.project();
      await harness.project('beta', '🌲');
      const parent = await harness.task();
      const target = await harness.task('beta');
      ok(
        await dependency(transport, parent.id, {
          mode: 'add',
          targetId: target.id,
          targetSlug: 'beta',
          revision: 1,
        }),
        transport,
        201,
      );
      const transition = {
        command: ['task', 'transition', parent.id],
        scope: 'alpha',
        path: `/projects/alpha/tasks/${parent.id}/transitions`,
        method: 'POST' as const,
        mutation: true,
        revision: 2,
        configRevision: 1,
        body: {
          to_status_id: 'done',
          confirmation: { asserted: true, user_text: 'Лично проверено' },
        },
      };
      const before = harness.snapshot();
      failure(await harness.request(transport, transition), 'DEPENDENCY_BLOCKED', transport);
      expect(harness.snapshot()).toEqual(before);
      ok(
        await harness.request('http', {
          ...transition,
          command: ['task', 'transition', target.id],
          scope: 'beta',
          path: `/projects/beta/tasks/${target.id}/transitions`,
          revision: 1,
        }),
        'http',
      );
      expect(
        ok(await dependency(transport, parent.id, { mode: 'list' }), transport).data,
      ).toMatchObject([{ satisfied: true }]);
      expect(ok(await harness.request(transport, transition), transport).data).toMatchObject({
        status_id: 'done',
        revision: 3,
      });
    });

    it('rejects the opposing edge of an actual cross-project graph without changing either task', async () => {
      await harness.project();
      await harness.project('beta', '🌲');
      const parent = await harness.task();
      const target = await harness.task('beta');
      ok(
        await dependency(transport, parent.id, {
          mode: 'add',
          targetId: target.id,
          targetSlug: 'beta',
          revision: 1,
        }),
        transport,
        201,
      );
      const before = harness.snapshot();
      failure(
        await dependency(transport, target.id, {
          mode: 'add',
          slug: 'beta',
          targetId: parent.id,
          targetSlug: 'alpha',
          revision: 1,
        }),
        'DEPENDENCY_BLOCKED',
        transport,
      );
      expect(harness.snapshot()).toEqual(before);
    });
  },
);
