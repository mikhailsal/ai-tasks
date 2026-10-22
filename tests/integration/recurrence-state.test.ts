import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createProject } from '../../src/core/projects/commands.js';
import { createTask } from '../../src/core/tasks/commands.js';
import {
  currentRecurrence,
  publishGeneration,
  requireRecurring,
  setRecurrenceBehavior,
} from '../../src/core/recurrence/generations.js';
import { formatTimestamp } from '../../src/core/time.js';
import { recurrenceInputSchema } from '../../src/schema/recurrence-input.js';
import {
  recurrenceIntervals,
  recurrenceState,
  scheduleGenerations,
} from '../../src/schema/recurrence.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import {
  outcomeSnapshot,
  seedOutcomeParent,
  seedOccurrence,
  occurrenceRows,
} from '../fixtures/occurrence-outcomes.js';

let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Поколения', emoji: '🧭' }),
  );
});
afterEach(() => fixture?.close());

function input(first: number, calendar = false) {
  return recurrenceInputSchema.parse({
    first_deadline: formatTimestamp(first),
    schedule: calendar
      ? { mode: 'calendar', pattern: 'days', every: 2, local_time: '13:00:00.123' }
      : { mode: 'after_completion', unit: 'hours', every: 2 },
    miss_policy: 'record_miss',
    confirmation_window_ms: 30_000,
  });
}
type WithoutTask<T> = T extends { task: unknown } ? Omit<T, 'task'> : never;
function publish(id: string, options: WithoutTask<Parameters<typeof publishGeneration>[1]>) {
  return fixture.connection.db.transaction(
    (transaction) =>
      publishGeneration(transaction, {
        ...options,
        task: requireRecurring(transaction, 'alpha', id),
      }),
    { behavior: 'immediate' },
  );
}
function initialParent() {
  const task = taskDetailSchema.parse(
    createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { kind: 'ordinary', title: 'Начальный черновик' }),
    ).data,
  );
  fixture.connection.sqlite
    .prepare("UPDATE tasks SET kind='recurring', status_id='draft' WHERE id=?")
    .run(task.id);
  return task.id;
}
function generationRows(id: string) {
  return fixture.connection.db
    .select()
    .from(scheduleGenerations)
    .where(eq(scheduleGenerations.taskId, id))
    .all();
}
function checkpoint(id: string) {
  return fixture.connection.db
    .select()
    .from(recurrenceState)
    .where(eq(recurrenceState.taskId, id))
    .get();
}

it('initial draft publication records a past explicit seed and checkpoint without obligations or active intervals', () => {
  const id = initialParent();
  const now = fixture.clock.now();
  const first = now - 86_400_000;
  const before = outcomeSnapshot(fixture);
  const generation = publish(id, {
    input: input(first),
    timezone: 'Europe/Moscow',
    now,
    entry: 'initial',
  });
  expect(generation).toMatchObject({
    taskId: id,
    projectSlug: 'alpha',
    generationNumber: 1,
    firstDeadline: first,
    timezone: 'Europe/Moscow',
    missPolicy: 'record_miss',
    windowMs: 30_000,
    createdAt: now,
    successorGenerationId: null,
  });
  expect(checkpoint(id)).toMatchObject({
    currentGenerationId: generation.id,
    revision: 1,
    cursorAnchor: null,
    waitingPredecessorId: null,
    nextCandidateAt: first,
  });
  expect(occurrenceRows(fixture, id)).toEqual([]);
  expect(fixture.connection.db.select().from(recurrenceIntervals).all()).toEqual([]);
  const after = outcomeSnapshot(fixture);
  expect(after.audit_records).toEqual(before.audit_records);
  expect(after.operation_receipts).toEqual(before.operation_receipts);
  expect(after.application_state).toEqual(before.application_state);
});

it('replacement preserves captured generation contents and materialized rows, linking a new current generation', () => {
  const parent = seedOutcomeParent(fixture);
  const occurrence = seedOccurrence(fixture, parent);
  const original = generationRows(parent.id)[0];
  const state = checkpoint(parent.id);
  const next = publish(parent.id, {
    input: input(fixture.clock.now() + 3_600_000),
    timezone: 'Europe/Berlin',
    now: fixture.clock.now(),
    entry: 'restart',
  });
  expect(generationRows(parent.id)).toEqual([
    { ...original, successorGenerationId: next.id },
    next,
  ]);
  expect(next).toMatchObject({
    generationNumber: 2,
    taskId: parent.id,
    timezone: 'Europe/Berlin',
    missPolicy: 'record_miss',
    windowMs: 30_000,
  });
  expect(checkpoint(parent.id)).toMatchObject({
    currentGenerationId: next.id,
    revision: (state?.revision ?? 0) + 1,
    cursorAnchor: null,
    waitingPredecessorId: null,
    nextCandidateAt: next.firstDeadline,
  });
  expect(occurrenceRows(fixture, parent.id)).toEqual([occurrence]);
  const third = publish(parent.id, {
    input: input(fixture.clock.now() + 7_200_000),
    timezone: 'Europe/Berlin',
    now: fixture.clock.now(),
    entry: 'paused',
  });
  expect(generationRows(parent.id)).toEqual([
    { ...original, successorGenerationId: next.id },
    { ...next, successorGenerationId: third.id },
    third,
  ]);
  expect(third.generationNumber).toBe(3);
  expect(checkpoint(parent.id)).toMatchObject({
    currentGenerationId: third.id,
    nextCandidateAt: null,
  });
});

it.each([-1, 0])(
  'active restart with anchor now%+d rejects without modifying any state',
  (offset) => {
    const parent = seedOutcomeParent(fixture);
    seedOccurrence(fixture, parent);
    const before = outcomeSnapshot(fixture);
    expect(() =>
      publish(parent.id, {
        input: input(fixture.clock.now() + offset),
        timezone: 'Europe/Moscow',
        now: fixture.clock.now(),
        entry: 'restart',
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(outcomeSnapshot(fixture)).toEqual(before);
  },
);

it('a future replacement cannot duplicate an existing same-parent deadline even across generations', () => {
  const parent = seedOutcomeParent(fixture, { mode: 'calendar' });
  const future = fixture.clock.now() + 86_400_000;
  seedOccurrence(fixture, parent, { deadline: future });
  publish(parent.id, {
    input: input(fixture.clock.now() + 3_600_000, true),
    timezone: 'Europe/Moscow',
    now: fixture.clock.now(),
    entry: 'restart',
  });
  const before = outcomeSnapshot(fixture);
  expect(() =>
    publish(parent.id, {
      input: input(future, true),
      timezone: 'Europe/Moscow',
      now: fixture.clock.now(),
      entry: 'restart',
    }),
  ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

it.each(['pending', 'debt'] as const)(
  'timing-mode switch refuses stored %s obligations atomically',
  (state) => {
    const parent = seedOutcomeParent(fixture);
    seedOccurrence(fixture, parent, { state });
    const before = outcomeSnapshot(fixture);
    expect(() =>
      publish(parent.id, {
        input: input(fixture.clock.now() + 86_400_000, true),
        timezone: 'Europe/Moscow',
        now: fixture.clock.now(),
        entry: 'restart',
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(outcomeSnapshot(fixture)).toEqual(before);
  },
);

it('a historical missed record permits a timing-mode switch while retaining immutable evidence', () => {
  const parent = seedOutcomeParent(fixture, { policy: 'record_miss' });
  const missed = seedOccurrence(fixture, parent, { state: 'missed' });
  const next = publish(parent.id, {
    input: input(fixture.clock.now() + 86_400_000, true),
    timezone: 'Europe/Moscow',
    now: fixture.clock.now(),
    entry: 'restart',
  });
  expect(next.mode).toBe('calendar');
  expect(occurrenceRows(fixture, parent.id)).toEqual([missed]);
});

it('timezone continuation advances a checkpoint without treating the historical seed as a restart or reseeding occurrences', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: fixture.clock.now() - 86_400_000,
  });
  const occurrence = seedOccurrence(fixture, parent);
  const cursor = fixture.clock.now();
  const nextCandidate = fixture.clock.now() + 86_400_000;
  const next = publish(parent.id, {
    input: input(parent.deadline, true),
    timezone: 'Europe/Berlin',
    now: fixture.clock.now(),
    entry: 'timezone',
    continuationAnchor: cursor,
    nextCandidate,
  });
  expect(next.firstDeadline).toBe(parent.deadline);
  expect(checkpoint(parent.id)).toMatchObject({
    currentGenerationId: next.id,
    cursorAnchor: cursor,
    nextCandidateAt: nextCandidate,
  });
  expect(occurrenceRows(fixture, parent.id)).toEqual([occurrence]);
});

it('a failure after generation insertion rolls back its successor link and checkpoint in the real transaction', () => {
  const parent = seedOutcomeParent(fixture);
  seedOccurrence(fixture, parent);
  const before = outcomeSnapshot(fixture);
  fixture.connection.sqlite.exec(`CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON recurrence_state
    BEGIN SELECT RAISE(ABORT, 'injected checkpoint persistence failure'); END`);
  expect(() =>
    publish(parent.id, {
      input: input(fixture.clock.now() + 3_600_000),
      timezone: 'Europe/Moscow',
      now: fixture.clock.now(),
      entry: 'restart',
    }),
  ).toThrow();
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

it('behavior intervals are half-open, adjacent and preserve every pre-materialized occurrence', () => {
  const parent = seedOutcomeParent(fixture);
  const row = seedOccurrence(fixture, parent);
  const first = fixture.connection.db.select().from(recurrenceIntervals).get();
  const pauseAt = fixture.clock.advanceBy(1_000);
  fixture.connection.db.transaction(
    (transaction) =>
      setRecurrenceBehavior(transaction, {
        task: requireRecurring(transaction, 'alpha', parent.id),
        generationId: parent.generation,
        behavior: 'paused',
        now: pauseAt,
      }),
    { behavior: 'immediate' },
  );
  const resumeAt = fixture.clock.advanceBy(5_000);
  fixture.connection.db.transaction(
    (transaction) =>
      setRecurrenceBehavior(transaction, {
        task: requireRecurring(transaction, 'alpha', parent.id),
        generationId: parent.generation,
        behavior: 'active',
        now: resumeAt,
      }),
    { behavior: 'immediate' },
  );
  const intervals = fixture.connection.db.select().from(recurrenceIntervals).all();
  expect(intervals).toHaveLength(3);
  expect(intervals[0]).toEqual({ ...first, endAt: pauseAt });
  expect(intervals[1]).toMatchObject({ behavior: 'paused', startAt: pauseAt, endAt: resumeAt });
  expect(intervals[2]).toMatchObject({ behavior: 'active', startAt: resumeAt, endAt: null });
  const at = (instant: number) =>
    intervals
      .filter(
        (interval) =>
          interval.startAt <= instant && (interval.endAt === null || instant < interval.endAt),
      )
      .map((interval) => interval.behavior);
  expect(at(pauseAt - 1)).toEqual(['active']);
  expect(at(pauseAt)).toEqual(['paused']);
  expect(at(resumeAt - 1)).toEqual(['paused']);
  expect(at(resumeAt)).toEqual(['active']);
  expect(occurrenceRows(fixture, parent.id)).toEqual([row]);
});

it('draft behavior closes an interval without opening an active period or changing obligations', () => {
  const parent = seedOutcomeParent(fixture);
  const row = seedOccurrence(fixture, parent);
  const now = fixture.clock.advanceBy(1);
  fixture.connection.db.transaction(
    (transaction) => {
      const task = requireRecurring(transaction, 'alpha', parent.id);
      const current = currentRecurrence(transaction, task);
      setRecurrenceBehavior(transaction, {
        task,
        generationId: current.generation.id,
        behavior: 'draft',
        now,
      });
    },
    { behavior: 'immediate' },
  );
  expect(fixture.connection.db.select().from(recurrenceIntervals).all()).toMatchObject([
    { behavior: 'active', endAt: now },
  ]);
  expect(occurrenceRows(fixture, parent.id)).toEqual([row]);
});

it.each([
  'past-floor',
  'behind-prior-cursor',
  'candidate-before-floor',
  'candidate-equal-floor',
] as const)(
  'timezone continuation rejects %s atomically without reseeding the first anchor',
  (invalid) => {
    const parent = seedOutcomeParent(fixture, {
      mode: 'calendar',
      deadline: fixture.clock.now() - 86_400_000,
    });
    seedOccurrence(fixture, parent);
    const now = fixture.clock.now();
    if (invalid === 'behind-prior-cursor')
      fixture.connection.sqlite
        .prepare('UPDATE recurrence_state SET cursor_anchor=? WHERE task_id=?')
        .run(now + 1, parent.id);
    const floor = invalid === 'past-floor' ? now - 1 : now;
    const candidate =
      invalid === 'candidate-before-floor'
        ? floor - 1
        : invalid === 'candidate-equal-floor'
          ? floor
          : now + 86_400_000;
    const before = outcomeSnapshot(fixture);
    expect(() =>
      publish(parent.id, {
        input: input(parent.deadline, true),
        timezone: 'Europe/Berlin',
        now,
        entry: 'timezone',
        continuationAnchor: floor,
        nextCandidate: candidate,
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(outcomeSnapshot(fixture)).toEqual(before);
  },
);
