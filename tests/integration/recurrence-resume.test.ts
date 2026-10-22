import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod/mini';
import { createProject } from '../../src/core/projects/commands.js';
import { completeOccurrences } from '../../src/core/recurrence/complete.js';
import { cancelOccurrences } from '../../src/core/recurrence/cancel.js';
import {
  publishGeneration,
  requireRecurring,
  setRecurrenceBehavior,
} from '../../src/core/recurrence/generations.js';
import { resumeRecurrence, validateResumeRecurrence } from '../../src/core/recurrence/resume.js';
import { recurrenceInputSchema } from '../../src/schema/recurrence-input.js';
import { recurrenceState, recurrenceIntervals } from '../../src/schema/recurrence.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import {
  seedOutcomeParent,
  seedOccurrence,
  occurrenceRows,
  outcomeInput,
  outcomeSnapshot,
  selection,
  type OutcomeParent,
} from '../fixtures/occurrence-outcomes.js';
const day = 86400000;
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Возобновление', emoji: '🌅' }),
  );
});
afterEach(() => fixture?.close());
function resume(id: string, firstDeadline?: string) {
  return fixture.connection.db.transaction(
    (transaction) =>
      resumeRecurrence(transaction, {
        task: requireRecurring(transaction, 'alpha', id),
        now: fixture.clock.now(),
        ...(firstDeadline === undefined ? {} : { firstDeadline }),
      }),
    { behavior: 'immediate' },
  );
}
function checkpoint(id: string) {
  const state = fixture.connection.db
    .select()
    .from(recurrenceState)
    .where(eq(recurrenceState.taskId, id))
    .get();
  if (!state) throw new Error('Missing seeded checkpoint');
  return state;
}
function activeIntervals(id: string) {
  return fixture.connection.db
    .select()
    .from(recurrenceIntervals)
    .where(eq(recurrenceIntervals.taskId, id))
    .all()
    .filter((interval) => interval.behavior === 'active' && interval.endAt === null);
}
function configuredCalendar(options: {
  first: number;
  timezone?: string;
  pattern?: 'days' | 'weeks' | 'months' | 'weekdays';
  every?: number;
  monthDay?: number;
  weekdays?: number[];
  localTime?: string;
}) {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    status: 'paused',
    deadline: options.first,
  });
  const pattern = options.pattern ?? 'days';
  const schedule = {
    mode: 'calendar',
    pattern,
    local_time: options.localTime ?? '13:00:00.123',
    ...(pattern === 'weekdays'
      ? { weekdays: options.weekdays ?? [1, 5] }
      : { every: options.every ?? 1 }),
    ...(pattern === 'months' ? { day_of_month: options.monthDay ?? 31 } : {}),
  };
  fixture.connection.db.transaction(
    (transaction) => {
      const task = requireRecurring(transaction, 'alpha', parent.id);
      const generation = publishGeneration(transaction, {
        task,
        now: fixture.clock.now(),
        entry: 'paused',
        timezone: options.timezone ?? 'Europe/Moscow',
        input: recurrenceInputSchema.parse({
          first_deadline: new Date(options.first).toISOString(),
          schedule,
          miss_policy: 'carry_forward',
          confirmation_window_ms: 0,
        }),
      });
      setRecurrenceBehavior(transaction, {
        task,
        generationId: generation.id,
        behavior: 'paused',
        now: fixture.clock.now(),
      });
    },
    { behavior: 'immediate' },
  );
  return parent;
}
function futureFirst() {
  return new Date(fixture.clock.now() + day).toISOString();
}
function expectRejected(parent: OutcomeParent, first?: string) {
  const before = outcomeSnapshot(fixture);
  expect(() => resume(parent.id, first)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
}
it('calendar resume seeks across a century of paused dates without initial reseeding or paused obligations', () => {
  const parent = configuredCalendar({ first: Date.UTC(1900, 0, 1, 10, 0, 0, 123) });
  const result = resume(parent.id);
  expect(occurrenceRows(fixture, parent.id)).toMatchObject([
    { deadline: fixture.clock.now() + day, state: 'pending' },
  ]);
  expect(occurrenceRows(fixture, parent.id)).toHaveLength(1);
  expect(result.events).toHaveLength(1);
  expect(activeIntervals(parent.id)).toMatchObject([{ startAt: fixture.clock.now() }]);
});
it('monthly resume retains requested month day after February clamp and chooses a strictly future wall time', () => {
  fixture.clock.set(Date.parse('2027-03-30T12:00:00Z'));
  const parent = configuredCalendar({
    first: Date.parse('2027-01-31T10:00:00.123Z'),
    pattern: 'months',
  });
  resume(parent.id);
  expect(occurrenceRows(fixture, parent.id).map((row) => row.deadline)).toEqual([
    Date.parse('2027-03-31T10:00:00.123Z'),
  ]);
});
it('week and weekday resume preserve cadence and selected ISO weekdays across a paused gap', () => {
  fixture.clock.set(Date.parse('2026-10-21T10:00:00.123Z'));
  const weekly = configuredCalendar({
    first: Date.parse('2026-10-01T10:00:00.123Z'),
    pattern: 'weeks',
    every: 2,
  });
  resume(weekly.id);
  expect(occurrenceRows(fixture, weekly.id).map((row) => row.deadline)).toEqual([
    Date.parse('2026-10-29T10:00:00.123Z'),
  ]);
  const weekdays = configuredCalendar({
    first: Date.parse('2026-10-01T10:00:00.123Z'),
    pattern: 'weekdays',
    weekdays: [1, 5],
  });
  resume(weekdays.id);
  expect(occurrenceRows(fixture, weekdays.id).map((row) => row.deadline)).toEqual([
    Date.parse('2026-10-23T10:00:00.123Z'),
  ]);
});
it('whole-day timezone gaps preserve the shared calendar iterator phase instead of shifting every-two-day cadence', () => {
  fixture.clock.set(Date.parse('2012-01-03T01:00:00Z'));
  const parent = configuredCalendar({
    first: Date.parse('2011-12-28T22:00:00Z'),
    timezone: 'Pacific/Apia',
    every: 2,
    localTime: '12:00:00.000',
  });
  resume(parent.id);
  expect(occurrenceRows(fixture, parent.id).map((row) => row.deadline)).toEqual([
    Date.parse('2012-01-03T22:00:00Z'),
  ]);
});
it.each(['pending', 'cancelled'] as const)(
  'calendar resume preserves accounted future %s identity instead of recreating that anchor',
  (state) => {
    const parent = seedOutcomeParent(fixture, {
      mode: 'calendar',
      status: 'paused',
      deadline: fixture.clock.now() + day,
    });
    const row = seedOccurrence(fixture, parent);
    if (state === 'cancelled')
      cancelOccurrences(
        fixture.human,
        'alpha',
        parent.id,
        outcomeInput(fixture, parent.id, {
          ...selection([row]),
          reason: 'Осознанно пропускаем период',
        }),
      );
    const existing = occurrenceRows(fixture, parent.id);
    resume(parent.id);
    expect(occurrenceRows(fixture, parent.id)).toEqual(existing);
    expect(activeIntervals(parent.id)).toHaveLength(1);
  },
);
it('calendar resume refuses an alternate anchor and leaves checkpoints, intervals and history unchanged', () => {
  const parent = configuredCalendar({ first: fixture.clock.now() - 10 * day });
  expectRejected(parent, futureFirst());
});
it.each(['pending', 'debt'] as const)(
  'elapsed resume keeps existing current %s work and rejects a competing first deadline',
  (state) => {
    const parent = seedOutcomeParent(fixture, {
      status: 'paused',
      deadline: fixture.clock.now() + day,
    });
    seedOccurrence(fixture, parent, { state });
    expectRejected(parent, futureFirst());
    const existing = occurrenceRows(fixture, parent.id);
    resume(parent.id);
    expect(occurrenceRows(fixture, parent.id)).toEqual(existing);
    expect(activeIntervals(parent.id)).toHaveLength(1);
  },
);
it('missed elapsed waiting state resumes without inventing an actual time or a successor', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    policy: 'record_miss',
    deadline: fixture.clock.now() - day,
  });
  seedOccurrence(fixture, parent, { state: 'missed' });
  expectRejected(parent, futureFirst());
  const existing = occurrenceRows(fixture, parent.id);
  const state = checkpoint(parent.id);
  resume(parent.id);
  expect(occurrenceRows(fixture, parent.id)).toEqual(existing);
  expect(checkpoint(parent.id)).toEqual(state);
  expect(activeIntervals(parent.id)).toHaveLength(1);
});
it('real completion while paused resumes its future actual-based candidate exactly once', () => {
  const parent = seedOutcomeParent(fixture, { status: 'paused', window: day });
  const row = seedOccurrence(fixture, parent);
  const actual = fixture.clock.now() - 600000;
  completeOccurrences(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, selection([row], actual)),
  );
  expectRejected(parent, futureFirst());
  const result = resume(parent.id);
  const rows = occurrenceRows(fixture, parent.id);
  const successor = rows.find((item) => item.id !== row.id);
  expect(successor).toMatchObject({
    occurrence_key: `after:${row.id}`,
    deadline: actual + 3600000,
    state: 'pending',
    actual_completed_at: null,
  });
  expect(rows).toHaveLength(2);
  expect(checkpoint(parent.id)).toMatchObject({
    waitingPredecessorId: successor?.id,
    nextCandidateAt: null,
  });
  expect(result.events).toHaveLength(1);
  resume(parent.id);
  expect(occurrenceRows(fixture, parent.id)).toEqual(rows);
});
it.each([-1, 0])(
  'expired elapsed candidate at now%+d needs explicit future restart and retains historical completion',
  (offset) => {
    const parent = seedOutcomeParent(fixture, { status: 'paused', window: day });
    const row = seedOccurrence(fixture, parent);
    const actual = fixture.clock.now() - 3600000 + offset;
    completeOccurrences(
      fixture.human,
      'alpha',
      parent.id,
      outcomeInput(fixture, parent.id, selection([row], actual)),
    );
    expectRejected(parent);
    expectRejected(parent, new Date(fixture.clock.now()).toISOString());
    const historical = occurrenceRows(fixture, parent.id)[0];
    const previousGeneration = checkpoint(parent.id).currentGenerationId;
    resume(parent.id, futureFirst());
    expect(checkpoint(parent.id).currentGenerationId).not.toBe(previousGeneration);
    expect(occurrenceRows(fixture, parent.id).find((item) => item.id === row.id)).toEqual(
      historical,
    );
    expect(occurrenceRows(fixture, parent.id)).toHaveLength(2);
    expect(occurrenceRows(fixture, parent.id).find((item) => item.id !== row.id)).toMatchObject({
      deadline: fixture.clock.now() + day,
      state: 'pending',
    });
  },
);
it.each([false, true])(
  'deferred unmaterialized elapsed seed uses original future anchor or requires restart; elapsed=%j',
  (elapsed) => {
    const first = fixture.clock.now() + (elapsed ? -day : day);
    const parent = seedOutcomeParent(fixture, { status: 'paused', deadline: first });
    fixture.connection.sqlite
      .prepare(
        'UPDATE recurrence_state SET cursor_anchor=NULL, next_candidate_at=NULL WHERE task_id=?',
      )
      .run(parent.id);
    const currentGeneration = checkpoint(parent.id).currentGenerationId;
    if (elapsed) expectRejected(parent);
    resume(parent.id, elapsed ? futureFirst() : undefined);
    expect(occurrenceRows(fixture, parent.id)).toMatchObject([
      { deadline: fixture.clock.now() + day, state: 'pending' },
    ]);
    if (!elapsed) expect(checkpoint(parent.id).currentGenerationId).toBe(currentGeneration);
  },
);
it('cancelled elapsed waiting seed cannot be revived implicitly and needs a new explicit future generation', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() + day,
  });
  const row = seedOccurrence(fixture, parent);
  cancelOccurrences(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, { ...selection([row]), reason: 'Первый период отменён' }),
  );
  const old = occurrenceRows(fixture, parent.id)[0];
  expectRejected(parent);
  resume(parent.id, new Date(fixture.clock.now() + 2 * day).toISOString());
  expect(occurrenceRows(fixture, parent.id)).toHaveLength(2);
  expect(occurrenceRows(fixture, parent.id).find((item) => item.id === row.id)).toEqual(old);
  expect(occurrenceRows(fixture, parent.id).find((item) => item.id !== row.id)).toMatchObject({
    deadline: fixture.clock.now() + 2 * day,
    state: 'pending',
  });
});
it('resume rolls back closed intervals and new generation when seed insertion fails', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() - day,
  });
  const before = outcomeSnapshot(fixture);
  fixture.connection.sqlite.exec(`CREATE TRIGGER reject_resume_seed BEFORE INSERT ON occurrences
    BEGIN SELECT RAISE(ABORT, 'injected resume seed failure'); END`);
  expect(() => resume(parent.id, futureFirst())).toThrow();
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it('resume caller receives immutable captured miss events when a paused window expires', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    policy: 'record_miss',
    deadline: fixture.clock.now() - 1,
  });
  const row = seedOccurrence(fixture, parent);
  const result = resume(parent.id);
  expect(result.events).toMatchObject([{ entity_id: row.id, action: 'occurrence.miss' }]);
  expect(result.events[0]?.config_snapshot).toEqual(
    z.json().parse(JSON.parse(row.schedule_snapshot)),
  );
  expect(occurrenceRows(fixture, parent.id)).toHaveLength(1);
  expect(occurrenceRows(fixture, parent.id)[0]).toMatchObject({
    state: 'missed',
    actual_completed_at: null,
  });
});
it('resume reconciles only pre-pause active arrears, then precreates one future anchor after the skipped interval', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    deadline: fixture.clock.now() - 5 * day,
  });
  seedOccurrence(fixture, parent);
  const pausedAt = parent.deadline + 2 * day + day / 2;
  fixture.connection.db.transaction(
    (transaction) =>
      setRecurrenceBehavior(transaction, {
        task: requireRecurring(transaction, 'alpha', parent.id),
        generationId: parent.generation,
        behavior: 'paused',
        now: pausedAt,
      }),
    { behavior: 'immediate' },
  );
  fixture.connection.sqlite
    .prepare("UPDATE tasks SET status_id='paused' WHERE id=?")
    .run(parent.id);
  resume(parent.id);
  const rows = occurrenceRows(fixture, parent.id);
  expect(rows.map((row) => row.deadline)).toEqual([
    parent.deadline,
    parent.deadline + day,
    parent.deadline + 2 * day,
    fixture.clock.now() + day,
  ]);
  expect(rows.slice(0, 3).map((row) => row.state)).toEqual(['debt', 'debt', 'debt']);
  expect(
    rows.filter((row) => row.deadline >= pausedAt && row.deadline <= fixture.clock.now()),
  ).toEqual([]);
  expect(activeIntervals(parent.id)).toHaveLength(1);
});
it.each([
  {
    kind: 'gap',
    now: '2026-03-08T06:00:00Z',
    first: '2026-03-01T07:30:00Z',
    time: '02:30:00.000',
    expected: '2026-03-08T07:30:00Z',
  },
  {
    kind: 'fold',
    now: '2026-11-01T04:00:00Z',
    first: '2026-10-25T05:30:00Z',
    time: '01:30:00.000',
    expected: '2026-11-01T05:30:00Z',
  },
])(
  'paused calendar seek retains generated $kind disambiguation',
  ({ now, first, time, expected }) => {
    fixture.clock.set(Date.parse(now));
    const parent = configuredCalendar({
      first: Date.parse(first),
      timezone: 'America/New_York',
      localTime: time,
    });
    resume(parent.id);
    expect(occurrenceRows(fixture, parent.id).map((row) => row.deadline)).toEqual([
      Date.parse(expected),
    ]);
  },
);
function validateResume(id: string) {
  fixture.connection.db.transaction((transaction) =>
    validateResumeRecurrence(transaction, {
      task: requireRecurring(transaction, 'alpha', id),
      now: fixture.clock.now(),
    }),
  );
}
it('pure and mutating elapsed resume allow equal-actual successor deadline to match its completed predecessor', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() + 3600000,
  });
  const row = seedOccurrence(fixture, parent);
  completeOccurrences(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, selection([row], fixture.clock.now())),
  );
  const before = outcomeSnapshot(fixture);
  expect(() => validateResume(parent.id)).not.toThrow();
  expect(outcomeSnapshot(fixture)).toEqual(before);
  resume(parent.id);
  const rows = occurrenceRows(fixture, parent.id);
  expect(rows).toHaveLength(2);
  expect(rows.every((item) => item.deadline === row.deadline)).toBe(true);
  expect(rows.find((item) => item.id !== row.id)).toMatchObject({
    occurrence_key: `after:${row.id}`,
    state: 'pending',
    actual_completed_at: null,
  });
});
it.each(['carry_forward', 'record_miss'] as const)(
  'pure resume evaluates logically expired %s without recording expiry or opening intervals',
  (policy) => {
    const parent = seedOutcomeParent(fixture, {
      status: 'paused',
      policy,
      deadline: fixture.clock.now() - 1,
    });
    const row = seedOccurrence(fixture, parent);
    const before = outcomeSnapshot(fixture);
    expect(() => validateResume(parent.id)).not.toThrow();
    expect(outcomeSnapshot(fixture)).toEqual(before);
    expect(occurrenceRows(fixture, parent.id)).toEqual([row]);
  },
);
it('pure calendar resume rejects a historical-generation future deadline collision without staged writes', () => {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    mode: 'calendar',
    deadline: fixture.clock.now() + day,
  });
  seedOccurrence(fixture, parent);
  fixture.connection.db.transaction(
    (transaction) => {
      const task = requireRecurring(transaction, 'alpha', parent.id);
      publishGeneration(transaction, {
        task,
        now: fixture.clock.now(),
        entry: 'paused',
        timezone: 'Europe/Moscow',
        input: recurrenceInputSchema.parse({
          first_deadline: new Date(fixture.clock.now() - day).toISOString(),
          schedule: parent.schedule,
          miss_policy: 'carry_forward',
          confirmation_window_ms: 0,
        }),
      });
    },
    { behavior: 'immediate' },
  );
  const before = outcomeSnapshot(fixture);
  expect(() => validateResume(parent.id)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
  expect(() => resume(parent.id)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it.each(['elapsed-expiry', 'calendar-next-anchor'] as const)(
  'pure and mutating resume reject supported-year overflow: %s',
  (kind) => {
    const last = Date.parse('9999-12-31T23:59:59.999Z');
    fixture.clock.set(last - 1000);
    const parent =
      kind === 'calendar-next-anchor'
        ? configuredCalendar({ first: last })
        : seedOutcomeParent(fixture, { status: 'paused', deadline: last, window: 1 });
    const before = outcomeSnapshot(fixture);
    expect(() => validateResume(parent.id)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(outcomeSnapshot(fixture)).toEqual(before);
    expect(() => resume(parent.id)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(outcomeSnapshot(fixture)).toEqual(before);
  },
);
it('pure resume refuses expiry backlog larger than one transaction budget even without owed calendar anchors', () => {
  const parent = seedOutcomeParent(fixture, {
    mode: 'calendar',
    status: 'paused',
    deadline: fixture.clock.now() - day,
  });
  for (let index = 0; index < 129; index++)
    seedOccurrence(fixture, parent, { deadline: fixture.clock.now() - index - 1 });
  const before = outcomeSnapshot(fixture);
  expect(() => validateResume(parent.id)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
  expect(() => resume(parent.id)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
