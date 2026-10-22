import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { createProject } from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { createTask, updateTask, archiveTask, restoreTask } from '../../src/core/tasks/commands.js';
import { transitionTask } from '../../src/core/tasks/transitions.js';
import { controlRecurrence } from '../../src/core/recurrence/control.js';
import { tickRecurrence } from '../../src/core/recurrence/tick.js';
import { projectConfigInputSchema } from '../../src/schema/configuration.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import type { MutationEnvelope, MutationSuccessEnvelope } from '../../src/schema/envelopes.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import {
  occurrenceRows,
  outcomeSnapshot,
  parentRevision,
  assertOutcomeCommit,
} from '../fixtures/occurrence-outcomes.js';
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  const config = createDefaultProjectConfig();
  config.recurring_workflow.transitions = config.recurring_workflow.transitions.map((edge) => ({
    ...edge,
    requires_confirmation:
      edge.to === 'archived' || (edge.from === 'archived' && edge.to === 'paused'),
  }));
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(
      fixture,
      jsonValueSchema.parse({
        slug: 'alpha',
        name: 'Повторяющиеся задачи',
        emoji: '🌅',
        config,
      }),
    ),
  );
});
afterEach(() => fixture?.close());
const consent = {
  asserted: true,
  user_text: '  Проверил именно этот переход.\nПродолжение отдельно.  ',
};
function recurrence() {
  return {
    first_deadline: new Date(fixture.clock.now() + 3600000).toISOString(),
    schedule: { mode: 'after_completion', unit: 'hours', every: 2 },
    miss_policy: 'carry_forward',
    confirmation_window_ms: 0,
  };
}
function taskInput(payload: JsonValue, id?: string): MutationEnvelope {
  return {
    ...ordinaryInput(fixture, payload, id ? { revision: parentRevision(fixture, id) } : {}),
    expected_settings_revision: 1,
  };
}
function create(emoji = '🧪') {
  return taskDetailSchema.parse(
    createTask(
      fixture.human,
      'alpha',
      taskInput({
        kind: 'recurring',
        title: 'Повторяемая проверка',
        emoji,
        description: '  # Инструкция\n\n**Точный** исходник 👩🏽‍💻  \n',
        recurrence: recurrence(),
      }),
    ).data,
  );
}
function archive(id: string) {
  return archiveTask(fixture.human, 'alpha', id, taskInput({ confirmation: consent }, id));
}
function audit(result: MutationSuccessEnvelope, id: string) {
  const events = assertOutcomeCommit(fixture, result);
  const saved = z
    .object({
      confirmation: z.nullable(z.string()),
      changes: z.string(),
      config_snapshot: z.nullable(z.string()),
    })
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT * FROM audit_records WHERE operation_id=? AND entity_id=?')
        .get(result.meta.operation_id, id),
    );
  expect(events.some((event) => event.entity_id === id)).toBe(true);
  return saved;
}
function reservations(id: string) {
  return fixture.connection.sqlite
    .prepare('SELECT * FROM task_emoji_reservations WHERE task_id=?')
    .all(id);
}
function activate(id: string) {
  return controlRecurrence(fixture.human, 'alpha', id, taskInput({ to_status_id: 'active' }, id));
}
function rejected(action: () => unknown, code = 'VALIDATION_ERROR') {
  const before = outcomeSnapshot(fixture);
  expect(action).toThrowError(expect.objectContaining({ code }));
  expect(outcomeSnapshot(fixture)).toEqual(before);
}
it('recurring creation stores an explicit initial draft generation with no obligations and an atomic semantic audit/receipt', () => {
  const payload = {
    kind: 'recurring',
    title: 'Создание повторения',
    emoji: '🧪',
    description: '  **Исходник**\n',
    priority: { model: 'classic', level: 'high' },
    recurrence: recurrence(),
  };
  const result = createTask(fixture.human, 'alpha', taskInput(payload));
  const task = taskDetailSchema.parse(result.data);
  expect(task).toMatchObject({
    kind: 'recurring',
    status_id: 'draft',
    category: 'draft',
    deadline: null,
    display_deadline: null,
    revision: 1,
    description: payload.description,
  });
  const generation = z
    .object({
      id: z.uuid(),
      task_id: z.uuid(),
      generation_number: z.number(),
      mode: z.string(),
      schedule: z.string(),
      first_deadline: z.number(),
      miss_policy: z.string(),
      window_ms: z.number(),
    })
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT * FROM schedule_generations WHERE task_id=?')
        .get(task.id),
    );
  expect(generation).toMatchObject({
    task_id: task.id,
    generation_number: 1,
    mode: 'after_completion',
    first_deadline: Date.parse(payload.recurrence.first_deadline),
    miss_policy: 'carry_forward',
    window_ms: 0,
  });
  expect(JSON.parse(generation.schedule)).toEqual(payload.recurrence.schedule);
  expect(occurrenceRows(fixture, task.id)).toEqual([]);
  expect(
    fixture.connection.sqlite
      .prepare('SELECT * FROM recurrence_intervals WHERE task_id=?')
      .all(task.id),
  ).toEqual([]);
  expect(reservations(task.id)).toHaveLength(1);
  const saved = audit(result, task.id);
  expect(JSON.parse(saved.config_snapshot ?? 'null')).toMatchObject({ revision: 1 });
  expect(JSON.parse(saved.changes)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'kind', before: null, after: 'recurring' }),
      expect.objectContaining({ field: 'status_id', before: null, after: 'draft' }),
      expect.objectContaining({
        field: 'recurrence',
        before: null,
        after: expect.objectContaining({
          generation_id: generation.id,
          generation_number: 1,
          first_deadline: payload.recurrence.first_deadline,
          schedule: payload.recurrence.schedule,
          timezone: 'Europe/Moscow',
          miss_policy: 'carry_forward',
          confirmation_window_ms: 0,
        }),
      }),
    ]),
  );
});
it('recurring creation rejects missing explicit seed/policy/window and supplied parent deadline atomically', () => {
  for (const missing of ['first_deadline', 'miss_policy', 'confirmation_window_ms']) {
    const rule: Record<string, unknown> = recurrence();
    delete rule[missing];
    const payload = jsonValueSchema.parse({
      kind: 'recurring',
      title: 'Недостаточные условия',
      recurrence: rule,
    });
    rejected(() => createTask(fixture.human, 'alpha', taskInput(payload)));
  }
  for (const deadline of [null, new Date(fixture.clock.now()).toISOString()])
    rejected(() =>
      createTask(
        fixture.human,
        'alpha',
        taskInput({
          kind: 'recurring',
          title: 'Производный срок',
          recurrence: recurrence(),
          deadline,
        }),
      ),
    );
});
it.each(['missing', 'stale'] as const)('recurring create requires current settings: %s', (kind) => {
  const input = taskInput({ kind: 'recurring', title: 'Настройки', recurrence: recurrence() });
  if (kind === 'missing') delete input.expected_settings_revision;
  else input.expected_settings_revision = 2;
  rejected(
    () => createTask(fixture.human, 'alpha', input),
    kind === 'missing' ? 'VALIDATION_ERROR' : 'CONFIG_CONFLICT',
  );
});
it('content-only recurring updates need no settings token and preserve existing immutable occurrence snapshots', () => {
  const task = create();
  activate(task.id);
  const occurrences = occurrenceRows(fixture, task.id);
  expect(occurrences).toHaveLength(1);
  const input = taskInput(
    { title: 'Новое название', description: '  Новая инструкция\n**Без правки истории**  ' },
    task.id,
  );
  delete input.expected_settings_revision;
  const result = updateTask(fixture.human, 'alpha', task.id, input);
  expect(taskDetailSchema.parse(result.data)).toMatchObject({
    title: 'Новое название',
    description: '  Новая инструкция\n**Без правки истории**  ',
    kind: 'recurring',
  });
  expect(occurrenceRows(fixture, task.id)).toEqual(occurrences);
  expect(reservations(task.id)).toHaveLength(1);
  audit(result, task.id);
});
it('recurring content patches cannot set or clear a derived parent deadline', () => {
  const task = create();
  for (const deadline of [null, new Date(fixture.clock.now()).toISOString()])
    rejected(() => updateTask(fixture.human, 'alpha', task.id, taskInput({ deadline }, task.id)));
});
it.each(['missing', 'stale'] as const)(
  'recurring direct lifecycle commands require settings while content edits do not: %s',
  (kind) => {
    for (const action of ['transition', 'archive', 'restore']) {
      const task = create('⚪');
      if (action === 'restore') archive(task.id);
      const payload =
        action === 'transition' ? { to_status_id: 'active' } : { confirmation: consent };
      const input = taskInput(payload, task.id);
      if (kind === 'missing') delete input.expected_settings_revision;
      else input.expected_settings_revision = 2;
      rejected(
        () => {
          if (action === 'transition')
            return transitionTask(fixture.human, 'alpha', task.id, input);
          if (action === 'archive') return archiveTask(fixture.human, 'alpha', task.id, input);
          return restoreTask(fixture.human, 'alpha', task.id, input);
        },
        kind === 'missing' ? 'VALIDATION_ERROR' : 'CONFIG_CONFLICT',
      );
    }
  },
);
it('direct task archive obeys the configured edge and stores exact transition confirmation before releasing its marker', () => {
  const task = create();
  for (const confirmation of [
    undefined,
    { asserted: true },
    { asserted: false, user_text: 'Не согласен' },
  ])
    rejected(
      () =>
        archiveTask(
          fixture.human,
          'alpha',
          task.id,
          taskInput(
            jsonValueSchema.parse(confirmation === undefined ? {} : { confirmation }),
            task.id,
          ),
        ),
      'CONFIRMATION_REQUIRED',
    );
  const result = archive(task.id);
  expect(taskDetailSchema.parse(result.data)).toMatchObject({
    status_id: 'archived',
    category: 'archived',
  });
  expect(reservations(task.id)).toEqual([]);
  expect(JSON.parse(audit(result, task.id).confirmation ?? 'null')).toEqual(consent);
});
it('direct recurring archive cannot hide pending or debt even after supplied confirmation', () => {
  const task = create();
  activate(task.id);
  rejected(() => archive(task.id));
  const pending = occurrenceRows(fixture, task.id)[0];
  if (!pending) throw new Error('Expected production activation to create the explicit seed');
  fixture.clock.set(pending.expires_at + 1);
  tickRecurrence(
    fixture.human,
    'alpha',
    taskInput({
      tasks: [{ task_id: task.id, expected_revision: parentRevision(fixture, task.id) }],
    }),
  );
  expect(occurrenceRows(fixture, task.id)[0]?.state).toBe('debt');
  rejected(() => archive(task.id));
});
it('direct restore requires exact configured consent and returns paused with no hidden activation', () => {
  const task = create();
  archive(task.id);
  for (const confirmation of [undefined, { asserted: true }, { asserted: false, user_text: 'Нет' }])
    rejected(
      () =>
        restoreTask(
          fixture.human,
          'alpha',
          task.id,
          taskInput(
            jsonValueSchema.parse(confirmation === undefined ? {} : { confirmation }),
            task.id,
          ),
        ),
      'CONFIRMATION_REQUIRED',
    );
  const result = restoreTask(
    fixture.human,
    'alpha',
    task.id,
    taskInput({ confirmation: consent, emoji_collision: 'reject' }, task.id),
  );
  expect(taskDetailSchema.parse(result.data)).toMatchObject({
    status_id: 'paused',
    category: 'paused',
    archived_at: null,
    emoji: '🧪',
  });
  expect(occurrenceRows(fixture, task.id)).toEqual([]);
  expect(
    fixture.connection.sqlite
      .prepare("SELECT * FROM recurrence_intervals WHERE task_id=? AND behavior='active'")
      .all(task.id),
  ).toEqual([]);
  expect(reservations(task.id)).toHaveLength(1);
  const saved = audit(result, task.id);
  expect(JSON.parse(saved.confirmation ?? 'null')).toEqual(consent);
  expect(JSON.parse(saved.config_snapshot ?? 'null')).toMatchObject({
    recurring_workflow: { restore_status_id: 'paused' },
  });
});
it('recurring restore rejects occupied marker atomically, audits explicit replacement and supports default fallback', () => {
  const task = create();
  archive(task.id);
  createTask(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { kind: 'ordinary', title: 'Новый владелец', emoji: '🧪' }),
  );
  rejected(
    () =>
      restoreTask(
        fixture.human,
        'alpha',
        task.id,
        taskInput({ confirmation: consent, emoji_collision: 'reject' }, task.id),
      ),
    'EMOJI_CONFLICT',
  );
  const replaced = restoreTask(
    fixture.human,
    'alpha',
    task.id,
    taskInput(
      { confirmation: consent, replacement_emoji: '⚙️', emoji_collision: 'reject' },
      task.id,
    ),
  );
  expect(taskDetailSchema.parse(replaced.data).emoji).toBe('⚙️');
  expect(JSON.parse(audit(replaced, task.id).changes)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'emoji', before: '🧪', after: '⚙️' }),
    ]),
  );
  const fallback = create('🧩');
  archive(fallback.id);
  createTask(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { kind: 'ordinary', title: 'Другой владелец', emoji: '🧩' }),
  );
  const result = restoreTask(
    fixture.human,
    'alpha',
    fallback.id,
    taskInput({ confirmation: consent }, fallback.id),
  );
  expect(taskDetailSchema.parse(result.data)).toMatchObject({ emoji: '⚪', category: 'paused' });
  expect(JSON.parse(audit(result, fallback.id).changes)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'emoji', before: '🧩', after: '⚪' }),
    ]),
  );
});
it('direct task transitions route recurring work through its configured lifecycle instead of ordinary statuses', () => {
  const task = create();
  const result = transitionTask(
    fixture.human,
    'alpha',
    task.id,
    taskInput({ to_status_id: 'active' }, task.id),
  );
  expect(taskDetailSchema.parse(result.data)).toMatchObject({
    kind: 'recurring',
    category: 'active',
  });
  expect(occurrenceRows(fixture, task.id)).toHaveLength(1);
  rejected(() =>
    transitionTask(fixture.human, 'alpha', task.id, taskInput({ to_status_id: 'done' }, task.id)),
  );
  const archived = create('⚪');
  archive(archived.id);
  const restored = transitionTask(
    fixture.human,
    'alpha',
    archived.id,
    taskInput({ to_status_id: 'paused', confirmation: consent }, archived.id),
  );
  expect(taskDetailSchema.parse(restored.data)).toMatchObject({
    category: 'paused',
    archived_at: null,
  });
  expect(occurrenceRows(fixture, archived.id)).toEqual([]);
});
it('recurring task create/archive/restore honor custom stable status IDs rather than hardcoded defaults', () => {
  const config = createDefaultProjectConfig();
  const ids = new Map([
    ['draft', 'waiting'],
    ['active', 'running'],
    ['paused', 'holding'],
    ['archived', 'retired'],
  ]);
  const mapped = (id: string) => ids.get(id) ?? id;
  const workflow = config.recurring_workflow;
  const custom = projectConfigInputSchema.parse({
    ...config,
    recurring_workflow: {
      ...workflow,
      initial_status_id: 'waiting',
      restore_status_id: 'holding',
      statuses: workflow.statuses.map((status) => ({ ...status, id: mapped(status.id) })),
      transitions: workflow.transitions.map((edge) => ({
        ...edge,
        from: mapped(edge.from),
        to: mapped(edge.to),
        requires_confirmation: edge.from === 'archived',
      })),
    },
  });
  createProject(
    fixture.human,
    'beta',
    ordinaryInput(
      fixture,
      jsonValueSchema.parse({ slug: 'beta', name: 'Иные статусы', emoji: '🌳', config: custom }),
      { projectSlug: 'beta' },
    ),
  );
  const input = (payload: JsonValue, id?: string): MutationEnvelope => ({
    ...ordinaryInput(fixture, payload, {
      projectSlug: 'beta',
      ...(id ? { revision: parentRevision(fixture, id) } : {}),
    }),
    expected_settings_revision: 1,
  });
  const task = taskDetailSchema.parse(
    createTask(
      fixture.human,
      'beta',
      input({
        kind: 'recurring',
        title: 'Другой граф',
        status_id: 'waiting',
        recurrence: recurrence(),
      }),
    ).data,
  );
  expect(task.status_id).toBe('waiting');
  archiveTask(fixture.human, 'beta', task.id, input({}, task.id));
  const restored = restoreTask(
    fixture.human,
    'beta',
    task.id,
    input({ confirmation: consent }, task.id),
  );
  expect(taskDetailSchema.parse(restored.data)).toMatchObject({
    status_id: 'holding',
    category: 'paused',
  });
  expect(occurrenceRows(fixture, task.id)).toEqual([]);
});
it('receipt failure during recurring creation rolls back the parent, generation, checkpoint, marker and audit', () => {
  const input = taskInput({
    kind: 'recurring',
    title: 'Атомарное создание',
    emoji: '🧪',
    recurrence: recurrence(),
  });
  const before = outcomeSnapshot(fixture);
  fixture.connection.sqlite
    .exec(`CREATE TRIGGER reject_recurring_create BEFORE INSERT ON operation_receipts
    BEGIN SELECT RAISE(ABORT, 'injected recurring creation receipt failure'); END`);
  expect(() => createTask(fixture.human, 'alpha', input)).toThrow();
  expect(outcomeSnapshot(fixture)).toEqual(before);
  fixture.connection.sqlite.exec('DROP TRIGGER reject_recurring_create');
  const result = createTask(fixture.human, 'alpha', input);
  const task = taskDetailSchema.parse(result.data);
  expect(
    fixture.connection.sqlite
      .prepare('SELECT * FROM schedule_generations WHERE task_id=?')
      .all(task.id),
  ).toHaveLength(1);
  audit(result, task.id);
});
