import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createProject } from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { configureRecurrence, controlRecurrence } from '../../src/core/recurrence/control.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import { tasks } from '../../src/schema/entities.js';
import { auditRecords } from '../../src/schema/history.js';
import {
  recurrenceIntervals,
  recurrenceState,
  scheduleGenerations,
} from '../../src/schema/recurrence.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import {
  occurrenceRows,
  outcomeInput,
  seedOccurrence,
  seedOutcomeParent,
} from '../fixtures/occurrence-outcomes.js';
import { dayMs, generationSnapshot, rule } from '../fixtures/recurrence-generations.js';

let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  const config = createDefaultProjectConfig();
  config.recurring_workflow.transitions = config.recurring_workflow.transitions.map((edge) => ({
    ...edge,
    requires_confirmation:
      (edge.from === 'active' && edge.to === 'paused') ||
      (edge.from === 'archived' && edge.to === 'paused'),
  }));
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, {
      slug: 'alpha',
      name: 'Управление',
      emoji: '🌊',
      config: jsonValueSchema.parse(config),
    }),
  );
  createProject(
    fixture.human,
    'beta',
    ordinaryInput(
      fixture,
      { slug: 'beta', name: 'Другой проект', emoji: '🌱' },
      { projectSlug: 'beta' },
    ),
  );
});
afterEach(() => fixture.close());

const consent = { asserted: true, user_text: '  Пользователь просит приостановить — точно.\n' };
function state(id: string) {
  return fixture.connection.db
    .select()
    .from(recurrenceState)
    .where(eq(recurrenceState.taskId, id))
    .get();
}
function draft(first: number) {
  const parent = seedOutcomeParent(fixture, { mode: 'calendar', deadline: first });
  fixture.connection.db
    .update(tasks)
    .set({ statusId: 'draft' })
    .where(eq(tasks.id, parent.id))
    .run();
  fixture.connection.db
    .delete(recurrenceIntervals)
    .where(eq(recurrenceIntervals.taskId, parent.id))
    .run();
  fixture.connection.db
    .update(recurrenceState)
    .set({ cursorAnchor: null, nextCandidateAt: first, waitingPredecessorId: null })
    .where(eq(recurrenceState.taskId, parent.id))
    .run();
  return parent;
}

it('a valid target status without a configured edge is rejected atomically', () => {
  const parent = seedOutcomeParent(fixture, { mode: 'calendar' });
  const before = generationSnapshot(fixture);
  expect(() =>
    controlRecurrence(
      fixture.human,
      'alpha',
      parent.id,
      outcomeInput(fixture, parent.id, { to_status_id: 'draft' }),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(generationSnapshot(fixture)).toEqual(before);
});

it.each([undefined, { asserted: true }])(
  'configured confirmation is required and complete before any pause writes',
  (confirmation) => {
    const parent = seedOutcomeParent(fixture, { mode: 'calendar' });
    const before = generationSnapshot(fixture);
    const payload =
      confirmation === undefined
        ? { to_status_id: 'paused' }
        : { to_status_id: 'paused', confirmation };
    expect(() =>
      controlRecurrence(
        fixture.human,
        'alpha',
        parent.id,
        outcomeInput(fixture, parent.id, payload),
      ),
    ).toThrow(expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }));
    expect(generationSnapshot(fixture)).toEqual(before);
  },
);

it('explicit configured-edge consent preserves exact user text and fixed source actor in audit', () => {
  const parent = seedOutcomeParent(fixture, { mode: 'calendar' });
  const result = controlRecurrence(
    fixture.agent('alpha'),
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, { to_status_id: 'paused', confirmation: consent }),
  );
  const event = fixture.connection.db
    .select()
    .from(auditRecords)
    .where(
      and(
        eq(auditRecords.operationId, result.meta.operation_id),
        eq(auditRecords.entityId, parent.id),
      ),
    )
    .get();
  expect(event).toMatchObject({
    action: 'recurrence.control',
    actor: 'ai-cli:alpha',
    confirmation: consent,
  });
  expect(
    fixture.connection.db.select().from(tasks).where(eq(tasks.id, parent.id)).get(),
  ).toMatchObject({ statusId: 'paused', revision: 2 });
});

it('draft activation seeds the explicit past instant but never reconstructs draft-period anchors', () => {
  const first = fixture.clock.now() - 4 * dayMs;
  const parent = draft(first);
  fixture.clock.advanceBy(1);
  controlRecurrence(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, { to_status_id: 'active' }),
  );
  const rows = occurrenceRows(fixture, parent.id);
  expect(
    rows.filter((row) => row.deadline <= fixture.clock.now()).map((row) => row.deadline),
  ).toEqual([first]);
  expect(rows.filter((row) => row.deadline > fixture.clock.now())).toHaveLength(1);
  expect(rows.every((row) => row.actual_completed_at === null)).toBe(true);
});

it('pause preserves existing occurrences and the pre-owed checkpoint for later reconciliation', () => {
  const first = fixture.clock.now() + dayMs;
  const parent = seedOutcomeParent(fixture, { mode: 'calendar', deadline: first });
  seedOccurrence(fixture, parent);
  const original = occurrenceRows(fixture, parent.id);
  const checkpoint = state(parent.id);
  fixture.clock.set(first + 3 * dayMs);
  controlRecurrence(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, { to_status_id: 'paused', confirmation: consent }),
  );
  expect(occurrenceRows(fixture, parent.id)).toEqual(original);
  expect(state(parent.id)).toEqual(checkpoint);
  expect(
    fixture.connection.db
      .select()
      .from(recurrenceIntervals)
      .where(eq(recurrenceIntervals.taskId, parent.id))
      .all(),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ behavior: 'active', endAt: fixture.clock.now() }),
      expect.objectContaining({ behavior: 'paused', startAt: fixture.clock.now(), endAt: null }),
    ]),
  );
});

it('active configuration reconciles only owed old anchors before publishing and seeding the new rule', () => {
  const first = fixture.clock.now() - 3 * dayMs;
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: first,
    policy: 'record_miss',
  });
  const original = seedOccurrence(fixture, parent);
  fixture.clock.advanceBy(1);
  const next = fixture.clock.now() + dayMs;
  configureRecurrence(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, rule(next)),
  );
  const rows = occurrenceRows(fixture, parent.id);
  const old = rows.filter((row) => row.generation_id === parent.generation);
  expect(old.map((row) => row.deadline)).toEqual([
    first,
    first + dayMs,
    first + 2 * dayMs,
    first + 3 * dayMs,
  ]);
  expect(old.every((row) => row.state === 'missed' && row.actual_completed_at === null)).toBe(true);
  expect(old.find((row) => row.id === original.id)).toMatchObject({
    schedule_snapshot: original.schedule_snapshot,
    description_snapshot: original.description_snapshot,
    description_html_snapshot: original.description_html_snapshot,
    expires_at: original.expires_at,
  });
  const current = state(parent.id)?.currentGenerationId;
  expect(current).not.toBe(parent.generation);
  expect(rows.filter((row) => row.generation_id === current)).toMatchObject([
    { deadline: next, state: 'pending' },
  ]);
  expect(rows).toHaveLength(5);
});

it('nonfuture active restart fails with complete rollback', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: fixture.clock.now() + dayMs,
  });
  seedOccurrence(fixture, parent);
  const before = generationSnapshot(fixture);
  expect(() =>
    configureRecurrence(
      fixture.human,
      'alpha',
      parent.id,
      outcomeInput(fixture, parent.id, rule(fixture.clock.now())),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(generationSnapshot(fixture)).toEqual(before);
});

it('a restart cannot reuse an existing first deadline even when the new generation would differ', () => {
  const first = fixture.clock.now() + dayMs;
  const parent = seedOutcomeParent(fixture, { mode: 'calendar', deadline: first });
  seedOccurrence(fixture, parent);
  const before = generationSnapshot(fixture);
  expect(() =>
    configureRecurrence(
      fixture.human,
      'alpha',
      parent.id,
      outcomeInput(fixture, parent.id, rule(first, { policy: 'record_miss' })),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(generationSnapshot(fixture)).toEqual(before);
});

it('timing-mode switches cannot discard open occurrences', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: fixture.clock.now() + dayMs,
  });
  seedOccurrence(fixture, parent);
  const before = generationSnapshot(fixture);
  expect(() =>
    configureRecurrence(
      fixture.human,
      'alpha',
      parent.id,
      outcomeInput(
        fixture,
        parent.id,
        rule(fixture.clock.now() + 2 * dayMs, {
          schedule: { mode: 'after_completion', unit: 'days', every: 1 },
        }),
      ),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(generationSnapshot(fixture)).toEqual(before);
});

it('paused configuration versions the rule without creating paused-period obligations', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    status: 'paused',
    deadline: fixture.clock.now() + dayMs,
  });
  seedOccurrence(fixture, parent);
  const before = occurrenceRows(fixture, parent.id);
  configureRecurrence(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, rule(fixture.clock.now() - 3 * dayMs)),
  );
  expect(occurrenceRows(fixture, parent.id)).toEqual(before);
  expect(state(parent.id)?.currentGenerationId).not.toBe(parent.generation);
  expect(
    fixture.connection.db
      .select()
      .from(scheduleGenerations)
      .where(eq(scheduleGenerations.taskId, parent.id))
      .all(),
  ).toHaveLength(2);
});

it('exact configuration replay precedes stale revisions and changed payload reusing the ID rejects', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: fixture.clock.now() + dayMs,
  });
  seedOccurrence(fixture, parent);
  const input = outcomeInput(fixture, parent.id, rule(fixture.clock.now() + 3 * dayMs));
  const result = configureRecurrence(fixture.human, 'alpha', parent.id, input);
  const before = generationSnapshot(fixture);
  fixture.clock.advanceBy(1_000);
  expect(configureRecurrence(fixture.human, 'alpha', parent.id, input)).toEqual(result);
  expect(() =>
    configureRecurrence(fixture.human, 'alpha', parent.id, {
      ...input,
      payload: rule(fixture.clock.now() + 4 * dayMs),
    }),
  ).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  expect(generationSnapshot(fixture)).toEqual(before);
});

it.each(['entity', 'config', 'settings', 'ownership'] as const)(
  'configuration %s guard rejects atomically',
  (guard) => {
    const parent = seedOutcomeParent(fixture, {
      mode: 'calendar',
      deadline: fixture.clock.now() + dayMs,
    });
    seedOccurrence(fixture, parent);
    const input = outcomeInput(fixture, parent.id, rule(fixture.clock.now() + 3 * dayMs));
    let slug = 'alpha';
    let code = 'CONFIG_CONFLICT';
    if (guard === 'entity') {
      input.expected_revision = 99;
      code = 'REVISION_CONFLICT';
    }
    if (guard === 'config') input.expected_config_revision = 99;
    if (guard === 'settings') input.expected_settings_revision = 99;
    if (guard === 'ownership') {
      slug = 'beta';
      code = 'PROJECT_MISMATCH';
    }
    const before = generationSnapshot(fixture);
    expect(() => configureRecurrence(fixture.human, slug, parent.id, input)).toThrow(
      expect.objectContaining({ code }),
    );
    expect(generationSnapshot(fixture)).toEqual(before);
  },
);

it('archived restoration requires complete configured consent and restores only to paused without activation', () => {
  const parent = draft(fixture.clock.now() - dayMs);
  controlRecurrence(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, { to_status_id: 'archived' }),
  );
  const archived = generationSnapshot(fixture);
  const checkpoint = state(parent.id);
  for (const confirmation of [undefined, { asserted: true }]) {
    const payload =
      confirmation === undefined
        ? { to_status_id: 'paused' }
        : { to_status_id: 'paused', confirmation };
    expect(() =>
      controlRecurrence(
        fixture.human,
        'alpha',
        parent.id,
        outcomeInput(fixture, parent.id, payload),
      ),
    ).toThrow(expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }));
    expect(generationSnapshot(fixture)).toEqual(archived);
  }
  const restoreConsent = { asserted: true, user_text: '  Восстановить в паузу, без запуска.\n' };
  const result = controlRecurrence(
    fixture.agent('alpha'),
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, { to_status_id: 'paused', confirmation: restoreConsent }),
  );
  expect(
    fixture.connection.db.select().from(tasks).where(eq(tasks.id, parent.id)).get(),
  ).toMatchObject({ statusId: 'paused', archivedAt: null });
  expect(occurrenceRows(fixture, parent.id)).toEqual([]);
  expect(state(parent.id)).toEqual(checkpoint);
  expect(
    fixture.connection.db
      .select()
      .from(auditRecords)
      .where(
        and(
          eq(auditRecords.operationId, result.meta.operation_id),
          eq(auditRecords.entityId, parent.id),
        ),
      )
      .get(),
  ).toMatchObject({ confirmation: restoreConsent, actor: 'ai-cli:alpha' });
  const intervals = fixture.connection.db
    .select()
    .from(recurrenceIntervals)
    .where(eq(recurrenceIntervals.taskId, parent.id))
    .all();
  expect(intervals.some((interval) => interval.behavior === 'active')).toBe(false);
  expect(intervals.filter((interval) => interval.endAt === null)).toEqual([
    expect.objectContaining({ behavior: 'paused' }),
  ]);
});

it('custom active through draft reactivation resumes history without seeding the draft-period past anchor', () => {
  const config = createDefaultProjectConfig();
  config.recurring_workflow.transitions.push({
    from: 'active',
    to: 'draft',
    requires_confirmation: false,
  });
  createProject(
    fixture.human,
    'gamma',
    ordinaryInput(
      fixture,
      { slug: 'gamma', name: 'Свой черновик', emoji: '☀️', config: jsonValueSchema.parse(config) },
      { projectSlug: 'gamma' },
    ),
  );
  const first = fixture.clock.now() - dayMs;
  const parent = seedOutcomeParent(fixture, {
    slug: 'gamma',
    mode: 'calendar',
    deadline: first,
    window: 30 * dayMs,
  });
  const original = seedOccurrence(fixture, parent, { key: `calendar:${first}` });
  controlRecurrence(
    fixture.human,
    'gamma',
    parent.id,
    outcomeInput(fixture, parent.id, { to_status_id: 'draft' }),
  );
  fixture.clock.advanceBy(2 * dayMs + 1);
  const draftAnchor = fixture.clock.now() - dayMs;
  configureRecurrence(
    fixture.human,
    'gamma',
    parent.id,
    outcomeInput(fixture, parent.id, rule(draftAnchor)),
  );
  const newGeneration = state(parent.id)?.currentGenerationId;
  expect(newGeneration).not.toBe(parent.generation);
  expect(occurrenceRows(fixture, parent.id)).toEqual([original]);
  fixture.clock.advanceBy(3 * dayMs);
  controlRecurrence(
    fixture.human,
    'gamma',
    parent.id,
    outcomeInput(fixture, parent.id, { to_status_id: 'active' }),
  );
  const rows = occurrenceRows(fixture, parent.id);
  expect(rows.find((row) => row.id === original.id)).toEqual(original);
  const resumed = rows.filter((row) => row.generation_id === newGeneration);
  expect(resumed).toHaveLength(1);
  expect(resumed[0]?.deadline).toBeGreaterThan(fixture.clock.now());
  expect(rows.filter((row) => row.deadline <= fixture.clock.now())).toEqual([original]);
  expect(rows.every((row) => row.actual_completed_at === null)).toBe(true);
});

it('never-active custom paused through draft cannot reactivate a seed elapsed during pause without future reconfiguration', () => {
  const config = createDefaultProjectConfig();
  config.recurring_workflow.transitions.push(
    { from: 'draft', to: 'paused', requires_confirmation: false },
    { from: 'paused', to: 'draft', requires_confirmation: false },
  );
  createProject(
    fixture.human,
    'gamma',
    ordinaryInput(
      fixture,
      {
        slug: 'gamma',
        name: 'Ещё не запускалась',
        emoji: '☀️',
        config: jsonValueSchema.parse(config),
      },
      { projectSlug: 'gamma' },
    ),
  );
  const first = fixture.clock.now() + 3_600_000;
  const recurrence = rule(first, {
    schedule: { mode: 'after_completion', unit: 'days', every: 1 },
    policy: 'record_miss',
    window: 0,
  });
  const id = taskDetailSchema.parse(
    createTask(fixture.human, 'gamma', {
      ...ordinaryInput(
        fixture,
        { kind: 'recurring', title: 'Без запуска', recurrence },
        { projectSlug: 'gamma' },
      ),
      expected_settings_revision: 1,
    }).data,
  ).id;
  controlRecurrence(
    fixture.human,
    'gamma',
    id,
    outcomeInput(fixture, id, { to_status_id: 'paused' }),
  );
  fixture.clock.advanceBy(2 * dayMs);
  controlRecurrence(
    fixture.human,
    'gamma',
    id,
    outcomeInput(fixture, id, { to_status_id: 'draft' }),
  );
  expect(occurrenceRows(fixture, id)).toEqual([]);
  const before = generationSnapshot(fixture);
  expect(() =>
    controlRecurrence(
      fixture.human,
      'gamma',
      id,
      outcomeInput(fixture, id, { to_status_id: 'active' }),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(generationSnapshot(fixture)).toEqual(before);
  const future = fixture.clock.now() + dayMs;
  configureRecurrence(
    fixture.human,
    'gamma',
    id,
    outcomeInput(fixture, id, { ...recurrence, first_deadline: new Date(future).toISOString() }),
  );
  controlRecurrence(
    fixture.human,
    'gamma',
    id,
    outcomeInput(fixture, id, { to_status_id: 'active' }),
  );
  const rows = occurrenceRows(fixture, id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    deadline: future,
    state: 'pending',
    actual_completed_at: null,
    completion_recorded_at: null,
  });
  expect(rows.some((row) => row.deadline === first)).toBe(false);
});
