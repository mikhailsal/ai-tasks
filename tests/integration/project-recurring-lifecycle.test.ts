import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { auditEventSchema } from '../../src/core/audit/append.js';
import { archiveProject, createProject, restoreProject } from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { controlRecurrence } from '../../src/core/recurrence/control.js';
import { tickRecurrence } from '../../src/core/recurrence/tick.js';
import { archiveTask, createTask } from '../../src/core/tasks/commands.js';
import { tasks } from '../../src/schema/entities.js';
import { auditRecords } from '../../src/schema/history.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import {
  dayMs,
  generationInput,
  generationSnapshot,
  rule,
  taskRevision,
} from '../fixtures/recurrence-generations.js';
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  const config = createDefaultProjectConfig();
  config.recurring_workflow.statuses = config.recurring_workflow.statuses.map((status) =>
    status.id === 'active' ? { ...status, id: 'operating' } : status,
  );
  config.recurring_workflow.statuses.push(
    { id: 'running', label: 'Другой активный', category: 'active' },
    { id: 'holding', label: 'Пауза восстановления', category: 'paused' },
  );
  config.recurring_workflow.restore_status_id = 'holding';
  config.recurring_workflow.transitions = config.recurring_workflow.transitions.map((edge) => ({
    ...edge,
    from: edge.from === 'active' ? 'operating' : edge.from,
    to:
      edge.to === 'active'
        ? 'operating'
        : edge.to === 'paused' && edge.from === 'archived'
          ? 'holding'
          : edge.to,
    requires_confirmation: edge.from === 'archived',
  }));
  config.recurring_workflow.transitions.push({
    from: 'draft',
    to: 'running',
    requires_confirmation: false,
  });
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, {
      slug: 'alpha',
      name: 'Смешанный',
      emoji: '🌊',
      config: jsonValueSchema.parse(config),
    }),
  );
  createProject(
    fixture.human,
    'beta',
    ordinaryInput(fixture, { slug: 'beta', name: 'Чужой', emoji: '🌱' }, { projectSlug: 'beta' }),
  );
});
afterEach(() => fixture.close());
function recurring(
  emoji: string,
  options: {
    first?: number;
    calendar?: boolean;
    policy?: 'record_miss' | 'carry_forward';
  } = {},
) {
  const first = options.first ?? fixture.clock.now() - dayMs;
  const result = createTask(
    fixture.human,
    'alpha',
    generationInput(fixture, {
      kind: 'recurring',
      title: `Работа ${emoji}`,
      emoji,
      recurrence: rule(first, {
        schedule: options.calendar
          ? { mode: 'calendar', pattern: 'days', every: 1, local_time: '13:00:00.123' }
          : { mode: 'after_completion', unit: 'hours', every: 1 },
        policy: options.policy ?? 'record_miss',
        window: 0,
      }),
    }),
  );
  return z.object({ id: z.uuid() }).parse(result.data).id;
}
function move(id: string, to: string) {
  controlRecurrence(fixture.human, 'alpha', id, generationInput(fixture, { to_status_id: to }, id));
}
function children() {
  return fixture.connection.db
    .select({ task_id: tasks.id, expected_revision: tasks.revision })
    .from(tasks)
    .where(eq(tasks.projectSlug, 'alpha'))
    .all();
}
function projectInput(affected = children()) {
  const revision = z
    .number()
    .parse(
      fixture.connection.sqlite
        .prepare("SELECT revision FROM projects WHERE slug='alpha'")
        .pluck()
        .get(),
    );
  return ordinaryInput(fixture, { affected_tasks: affected }, { revision });
}
function taskRows() {
  return fixture.connection.db.select().from(tasks).where(eq(tasks.projectSlug, 'alpha')).all();
}
function reservations() {
  return fixture.connection.sqlite
    .prepare("SELECT * FROM task_emoji_reservations WHERE project_slug='alpha' ORDER BY task_id")
    .all();
}
function occurrences() {
  return fixture.connection.sqlite
    .prepare("SELECT * FROM occurrences WHERE project_slug='alpha' ORDER BY id")
    .all();
}
function mixedChildren() {
  const active = recurring('🧪');
  move(active, 'operating');
  const secondActive = recurring('🧭');
  move(secondActive, 'running');
  const paused = recurring('🪴');
  move(paused, 'operating');
  move(paused, 'paused');
  const draft = recurring('📚', { first: fixture.clock.now() + dayMs });
  const archived = recurring('🛟', { first: fixture.clock.now() + dayMs });
  archiveTask(fixture.human, 'alpha', archived, generationInput(fixture, {}, archived));
  const ordinary = z
    .object({ id: z.uuid() })
    .parse(
      createTask(
        fixture.human,
        'alpha',
        ordinaryInput(fixture, { kind: 'ordinary', title: 'Обычный ребёнок', emoji: '⚙️' }),
      ).data,
    ).id;
  return { active, secondActive, paused, draft, archived, ordinary };
}
it('archive preserves exact mixed child rows and markers; restore administratively pauses only both active categories', () => {
  const ids = mixedChildren();
  const before = taskRows();
  const markers = reservations();
  const history = occurrences();
  const input = projectInput();
  expect(input).not.toHaveProperty('expected_settings_revision');
  archiveProject(fixture.human, 'alpha', input);
  expect(taskRows()).toEqual(before);
  expect(reservations()).toEqual(markers);
  expect(occurrences()).toEqual(history);
  fixture.clock.advanceBy(dayMs);
  const result = restoreProject(fixture.human, 'alpha', projectInput());
  const activeIds = [ids.active, ids.secondActive];
  const after = taskRows();
  for (const original of before) {
    const restored = after.find((row) => row.id === original.id);
    if (activeIds.includes(original.id))
      expect(restored).toEqual({
        ...original,
        statusId: 'holding',
        revision: original.revision + 1,
        updatedAt: fixture.clock.now(),
      });
    else expect(restored).toEqual(original);
  }
  expect(reservations()).toEqual(markers);
  expect(occurrences()).toEqual(history);
  const events = fixture.connection.db
    .select()
    .from(auditRecords)
    .where(
      and(
        eq(auditRecords.operationId, result.meta.operation_id),
        eq(auditRecords.entityType, 'task'),
      ),
    )
    .all();
  expect(events.map((event) => event.entityId).sort()).toEqual(activeIds.sort());
  expect(events.every((event) => event.confirmation === null)).toBe(true);
  expect(
    events.every((event) =>
      auditEventSchema.shape.changes
        .parse(event.changes)
        .some((change) => change.field === 'status_id' && change.after === 'holding'),
    ),
  ).toBe(true);
  fixture.clock.advanceBy(10 * dayMs);
  tickRecurrence(
    fixture.human,
    'alpha',
    generationInput(fixture, {
      tasks: [ids.active, ids.secondActive, ids.paused].map((task_id) => ({
        task_id,
        expected_revision: taskRevision(fixture, task_id),
      })),
    }),
  );
  expect(occurrences()).toEqual(history);
});
it.each(['stale', 'missing', 'foreign'] as const)(
  'archive validates %s complete child claims including individually archived children before interval writes',
  (invalid) => {
    const ids = mixedChildren();
    let claims = children();
    let code = 'REVISION_CONFLICT';
    if (invalid === 'stale')
      claims = claims.map((row) =>
        row.task_id === ids.archived
          ? { ...row, expected_revision: row.expected_revision + 1 }
          : row,
      );
    if (invalid === 'missing') {
      claims = claims.filter((row) => row.task_id !== ids.archived);
      code = 'VALIDATION_ERROR';
    }
    if (invalid === 'foreign') {
      const foreign = z
        .object({ id: z.uuid(), revision: z.number() })
        .parse(
          createTask(
            fixture.human,
            'beta',
            ordinaryInput(fixture, { kind: 'ordinary', title: 'Чужой' }, { projectSlug: 'beta' }),
          ).data,
        );
      claims.push({ task_id: foreign.id, expected_revision: foreign.revision });
      code = 'PROJECT_MISMATCH';
    }
    const before = generationSnapshot(fixture);
    expect(() => archiveProject(fixture.human, 'alpha', projectInput(claims))).toThrow(
      expect.objectContaining({ code }),
    );
    expect(generationSnapshot(fixture)).toEqual(before);
  },
);
it.each(['pending', 'debt', 'owed'] as const)(
  'archive cannot hide %s recurrence work or implicitly process it',
  (blocker) => {
    const id = recurring('🧪', {
      first: blocker === 'debt' ? fixture.clock.now() - dayMs : fixture.clock.now() + dayMs,
      calendar: blocker === 'owed',
      policy: blocker === 'debt' ? 'carry_forward' : 'record_miss',
    });
    move(id, 'operating');
    if (blocker === 'owed') fixture.clock.advanceBy(4 * dayMs + 1);
    const before = generationSnapshot(fixture);
    expect(() => archiveProject(fixture.human, 'alpha', projectInput())).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        details: expect.objectContaining({
          reason: blocker === 'owed' ? 'owed_anchors' : 'open_occurrences',
        }),
      }),
    );
    expect(generationSnapshot(fixture)).toEqual(before);
  },
);
it('archive and restore exact receipts replay before stale parent/child revisions while changed payload rejects', () => {
  mixedChildren();
  for (const mutate of [archiveProject, restoreProject]) {
    const input = projectInput();
    const result = mutate(fixture.human, 'alpha', input);
    const committed = generationSnapshot(fixture);
    fixture.clock.advanceBy(1000);
    expect(mutate(fixture.human, 'alpha', input)).toEqual(result);
    expect(() =>
      mutate(fixture.human, 'alpha', { ...input, payload: { affected_tasks: [] } }),
    ).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    expect(generationSnapshot(fixture)).toEqual(committed);
    const receipt = fixture.connection.sqlite
      .prepare('SELECT result FROM operation_receipts WHERE operation_id=?')
      .pluck()
      .get(result.meta.operation_id);
    expect(JSON.parse(z.string().parse(receipt))).toEqual(result);
  }
});
it.each(['audit_records', 'operation_receipts'] as const)(
  'restore %s insertion failure rolls back every child, interval and project change',
  (table) => {
    mixedChildren();
    archiveProject(fixture.human, 'alpha', projectInput());
    fixture.clock.advanceBy(dayMs);
    fixture.connection.sqlite.exec(
      `CREATE TRIGGER deny_project_restore BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected project restore failure'); END`,
    );
    const before = generationSnapshot(fixture);
    expect(() => restoreProject(fixture.human, 'alpha', projectInput())).toThrow(
      'injected project restore failure',
    );
    expect(generationSnapshot(fixture)).toEqual(before);
  },
);
