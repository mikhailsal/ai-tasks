import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { createProject, updateProject } from '../../src/core/projects/commands.js';
import { createTask, updateTask, archiveTask, restoreTask } from '../../src/core/tasks/commands.js';
import { transitionTask } from '../../src/core/tasks/transitions.js';
import { getProjectConfiguration } from '../../src/core/queries/configuration.js';
import { taskDetailSchema, type TaskDetail } from '../../src/schema/tasks.js';
import type { MutationSuccessEnvelope } from '../../src/schema/envelopes.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  ordinarySnapshot,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Альфа', emoji: '🚀' }),
  );
});
afterEach(() => fixture?.close());
function create(emoji = '🧪') {
  return taskDetailSchema.parse(
    createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { kind: 'ordinary', title: 'Работа с маркером', emoji }),
    ).data,
  );
}
function transition(task: TaskDetail, to: string) {
  return transitionTask(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(
      fixture,
      to === 'done'
        ? { to_status_id: to, confirmation: { asserted: true, user_text: 'Проверил результат' } }
        : { to_status_id: to },
      { revision: task.revision },
    ),
  );
}
function finish(task: TaskDetail) {
  let current = task;
  for (const status of ['planning', 'ready', 'in_progress', 'sanity_check', 'done'])
    current = taskDetailSchema.parse(transition(current, status).data);
  return current;
}
const returnCases = ['completed', 'cancelled', 'archived'] as const;
type ReturnCase = (typeof returnCases)[number];
function releasedTask(kind: ReturnCase) {
  const task = create();
  if (kind === 'completed') return finish(task);
  if (kind === 'cancelled') return taskDetailSchema.parse(transition(task, 'cancelled').data);
  return taskDetailSchema.parse(
    archiveTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, {}, { revision: task.revision }),
    ).data,
  );
}
function returnTask(
  task: TaskDetail,
  kind: ReturnCase,
  marker: {
    replacement_emoji?: string;
    emoji_collision?: 'reject' | 'use_default';
  } = {},
) {
  const payload =
    kind === 'archived'
      ? { ...marker }
      : { ...marker, to_status_id: kind === 'completed' ? 'in_progress' : 'idea' };
  const input = ordinaryInput(fixture, payload, { revision: task.revision });
  return kind === 'archived'
    ? restoreTask(fixture.human, 'alpha', task.id, input)
    : transitionTask(fixture.human, 'alpha', task.id, input);
}
function reservation(taskId: string) {
  return fixture.connection.sqlite
    .prepare('SELECT project_slug, emoji_key FROM task_emoji_reservations WHERE task_id = ?')
    .get(taskId);
}
function audit(result: MutationSuccessEnvelope) {
  expect(result.meta.audit_ids).toHaveLength(1);
  const row = z
    .object({ changes: z.string(), config_snapshot: z.string() })
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT changes, config_snapshot FROM audit_records WHERE id = ?')
        .get(result.meta.audit_ids[0]),
    );
  expect(JSON.parse(row.config_snapshot)).toEqual(
    getProjectConfiguration(fixture.human, 'alpha').data,
  );
  expect(
    fixture.connection.sqlite
      .prepare('SELECT count(*) FROM operation_receipts WHERE operation_id = ?')
      .pluck()
      .get(result.meta.operation_id),
  ).toBe(1);
  return z
    .array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() }))
    .parse(JSON.parse(row.changes));
}
it.each(returnCases)(
  '%s releases a real command reservation and defaults occupied return to ⚪',
  (kind) => {
    const released = releasedTask(kind);
    expect(released.emoji).toBe('🧪');
    expect(reservation(released.id)).toBeUndefined();
    const occupier = create();
    expect(reservation(occupier.id)).toEqual({ project_slug: 'alpha', emoji_key: '🧪' });
    const result = returnTask(released, kind);
    const restored = taskDetailSchema.parse(result.data);
    expect(restored).toMatchObject({
      emoji: '⚪',
      archived_at: null,
      status_id: kind === 'completed' ? 'in_progress' : 'idea',
      revision: released.revision + 1,
    });
    expect(reservation(restored.id)).toBeUndefined();
    expect(reservation(occupier.id)).toEqual({ project_slug: 'alpha', emoji_key: '🧪' });
    expect(audit(result)).toContainEqual({ field: 'emoji', before: '🧪', after: '⚪' });
  },
);
it.each(returnCases)(
  '%s return explicitly rejects collisions atomically and audits a replacement',
  (kind) => {
    const released = releasedTask(kind);
    const occupier = create();
    const before = ordinarySnapshot(fixture);
    expect(() => returnTask(released, kind, { emoji_collision: 'reject' })).toThrowError(
      expect.objectContaining({ code: 'EMOJI_CONFLICT' }),
    );
    expect(ordinarySnapshot(fixture)).toEqual(before);
    const result = returnTask(released, kind, {
      emoji_collision: 'reject',
      replacement_emoji: '🎯',
    });
    expect(taskDetailSchema.parse(result.data).emoji).toBe('🎯');
    expect(reservation(released.id)).toEqual({ project_slug: 'alpha', emoji_key: '🎯' });
    expect(reservation(occupier.id)).toEqual({ project_slug: 'alpha', emoji_key: '🧪' });
    expect(audit(result)).toContainEqual({ field: 'emoji', before: '🧪', after: '🎯' });
  },
);
it('real create/edit reject collisions without fallback or partial marker/source changes', () => {
  const first = create();
  const edited = create('🎯');
  const before = ordinarySnapshot(fixture);
  expect(() => create()).toThrowError(expect.objectContaining({ code: 'EMOJI_CONFLICT' }));
  expect(ordinarySnapshot(fixture)).toEqual(before);
  expect(() =>
    updateTask(
      fixture.human,
      'alpha',
      edited.id,
      ordinaryInput(
        fixture,
        { emoji: '🧪', description: 'This proposal must not be partially committed' },
        { revision: edited.revision },
      ),
    ),
  ).toThrowError(expect.objectContaining({ code: 'EMOJI_CONFLICT' }));
  expect(ordinarySnapshot(fixture)).toEqual(before);
  expect(reservation(first.id)).toEqual({ project_slug: 'alpha', emoji_key: '🧪' });
  expect(reservation(edited.id)).toEqual({ project_slug: 'alpha', emoji_key: '🎯' });
  const result = updateTask(
    fixture.human,
    'alpha',
    edited.id,
    ordinaryInput(fixture, { emoji: '🌻' }, { revision: edited.revision }),
  );
  expect(reservation(edited.id)).toEqual({ project_slug: 'alpha', emoji_key: '🌻' });
  expect(audit(result)).toContainEqual({ field: 'emoji', before: '🎯', after: '🌻' });
  expect(create('🎯').emoji).toBe('🎯');
});
it('nonreturn transitions reject default fallback and new tasks share the default without reservations', () => {
  const task = create();
  const before = ordinarySnapshot(fixture);
  expect(() =>
    transitionTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(
        fixture,
        { to_status_id: 'planning', emoji_collision: 'use_default' },
        { revision: task.revision },
      ),
    ),
  ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(ordinarySnapshot(fixture)).toEqual(before);
  for (let count = 0; count < 2; count += 1) {
    const shared = create('⚪');
    expect(shared.emoji).toBe('⚪');
    expect(reservation(shared.id)).toBeUndefined();
  }
});
it('real project marker edits permanently reserve former keys against projects and tasks', () => {
  const result = updateProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { emoji: '🌲' }, { revision: 1 }),
  );
  expect(audit(result)).toContainEqual({ field: 'emoji', before: '🚀', after: '🌲' });
  const reserved = fixture.connection.sqlite
    .prepare('SELECT emoji_key, project_slug FROM project_emoji_reservations ORDER BY emoji_key')
    .all();
  expect(reserved).toEqual(
    expect.arrayContaining([
      { emoji_key: '🚀', project_slug: 'alpha' },
      { emoji_key: '🌲', project_slug: 'alpha' },
    ]),
  );
  const before = ordinarySnapshot(fixture);
  for (const emoji of ['🚀', '🌲']) {
    expect(() => create(emoji)).toThrowError(expect.objectContaining({ code: 'EMOJI_CONFLICT' }));
    expect(() =>
      createProject(
        fixture.human,
        'beta',
        ordinaryInput(fixture, { slug: 'beta', name: 'Бета', emoji }, { projectSlug: 'beta' }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'EMOJI_CONFLICT' }));
    expect(ordinarySnapshot(fixture)).toEqual(before);
  }
});
