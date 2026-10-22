import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createProject } from '../../src/core/projects/commands.js';
import { formatTimestamp } from '../../src/core/time.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  invokeOrdinaryCli,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import {
  outcomeApi,
  recurrenceInput,
  seedOutcomeParent,
  seedOccurrence,
  selection,
  occurrenceRows,
  outcomeInput,
  outcomeSnapshot,
  assertOutcomeCommit,
  parentRevision,
} from '../fixtures/occurrence-outcomes.js';

let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Альфа', emoji: '🚀' }),
  );
  createProject(
    fixture.human,
    'beta',
    ordinaryInput(fixture, { slug: 'beta', name: 'Бета', emoji: '🌿' }, { projectSlug: 'beta' }),
  );
});
afterEach(() => fixture?.close());

it('compiled task create accepts valid recurring work after successful metadata [US5 behavioral RED]', () => {
  const metadata = invokeOrdinaryCli(fixture, ['meta', '--all-projects', '--json'], {});
  expect(metadata.status, metadata.stderr).toBe(0);
  expect(JSON.parse(metadata.stdout)).toMatchObject({
    ok: true,
    data: { database_epoch: fixture.epoch },
  });
  const result = invokeOrdinaryCli(
    fixture,
    ['task', 'create', '--project', 'alpha', '--json', '--input', '-'],
    {
      operation_id: randomUUID(),
      database_epoch: fixture.epoch,
      expected_config_revision: 1,
      expected_settings_revision: 1,
      kind: 'recurring',
      title: 'Проверка оборудования',
      recurrence: recurrenceInput(fixture.clock.now()),
    },
  );
  expect(result.status, `Expected recurring creation success; stderr=${result.stderr}`).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { kind: 'recurring' } });
});

const policies = ['carry_forward', 'record_miss'] as const;
const windows = [0, 2_592_000_000];
const boundaries = policies.flatMap((policy) =>
  windows.flatMap((window) => [-1, 0, 1].map((offset) => ({ policy, window, offset }))),
);
it.each(boundaries)(
  'completion $policy window=$window recorded at expiry+$offset',
  async ({ policy, window, offset }) => {
    const api = await outcomeApi();
    const parent = seedOutcomeParent(fixture, { policy, window });
    const original = seedOccurrence(fixture, parent);
    fixture.clock.set(original.expires_at + offset);
    const result = api.complete(
      fixture.human,
      'alpha',
      parent.id,
      outcomeInput(fixture, parent.id, selection([original])),
    );
    const row = occurrenceRows(fixture, parent.id).find((item) => item.id === original.id);
    expect(row).toMatchObject({
      state: offset > 0 ? 'completed_late' : 'completed',
      actual_completed_at: fixture.clock.now(),
      completion_recorded_at: fixture.clock.now(),
      missed_at: offset > 0 ? original.expires_at : null,
      description_snapshot: original.description_snapshot,
      description_html_snapshot: original.description_html_snapshot,
      schedule_snapshot: original.schedule_snapshot,
    });
    const events = assertOutcomeCommit(fixture, result).filter(
      (event) => event.entity_id === original.id,
    );
    const changes = events.map((event) => JSON.parse(event.changes));
    expect(changes.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'state',
          after: offset > 0 ? 'completed_late' : 'completed',
        }),
      ]),
    );
    if (offset > 0)
      expect(changes.flat()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'state',
            after: policy === 'carry_forward' ? 'debt' : 'missed',
          }),
        ]),
      );
  },
);

it.each(policies.flatMap((policy) => windows.map((window) => ({ policy, window }))))(
  'tick expiry is strict and preserves one prior $policy miss with window=$window',
  async ({ policy, window }) => {
    const api = await outcomeApi();
    const parent = seedOutcomeParent(fixture, { policy, window });
    const pending = seedOccurrence(fixture, parent);
    fixture.clock.set(pending.expires_at);
    const tickInput = () => ({
      ...ordinaryInput(fixture, {
        tasks: [{ task_id: parent.id, expected_revision: parentRevision(fixture, parent.id) }],
      }),
      expected_settings_revision: 1,
    });
    api.tick(fixture.human, 'alpha', tickInput());
    expect(occurrenceRows(fixture, parent.id)[0]).toMatchObject({
      state: 'pending',
      missed_at: null,
    });
    fixture.clock.advanceBy(1);
    const expired = api.tick(fixture.human, 'alpha', tickInput());
    const missed = occurrenceRows(fixture, parent.id).find((row) => row.id === pending.id);
    expect(missed).toMatchObject({
      state: policy === 'carry_forward' ? 'debt' : 'missed',
      missed_at: pending.expires_at,
    });
    const expiryEvents = assertOutcomeCommit(fixture, expired).filter(
      (event) => event.entity_id === pending.id,
    );
    expect(expiryEvents).toHaveLength(1);
    api.tick(fixture.human, 'alpha', tickInput());
    const persisted = occurrenceRows(fixture, parent.id).filter((row) => row.id === pending.id);
    const completion = api.complete(
      fixture.human,
      'alpha',
      parent.id,
      outcomeInput(fixture, parent.id, selection(persisted)),
    );
    const completionEvents = assertOutcomeCommit(fixture, completion).filter(
      (event) => event.entity_id === pending.id,
    );
    expect(completionEvents).toHaveLength(1);
    expect(occurrenceRows(fixture, parent.id).find((row) => row.id === pending.id)).toMatchObject({
      state: 'completed_late',
      missed_at: pending.expires_at,
    });
    expect(
      fixture.connection.sqlite
        .prepare('SELECT id FROM audit_records WHERE operation_id = ?')
        .all(expired.meta.operation_id),
    ).toHaveLength(expired.meta.audit_ids.length);
  },
);

it('backdating actual does not make a late recorded completion timely', async () => {
  const api = await outcomeApi();
  const parent = seedOutcomeParent(fixture);
  const pending = seedOccurrence(fixture, parent);
  fixture.clock.advanceBy(1);
  const actual = pending.deadline - 60_000;
  const result = api.complete(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, selection([pending], actual)),
  );
  expect(occurrenceRows(fixture, parent.id).find((row) => row.id === pending.id)).toMatchObject({
    state: 'completed_late',
    actual_completed_at: actual,
    completion_recorded_at: fixture.clock.now(),
    missed_at: pending.expires_at,
  });
  assertOutcomeCommit(fixture, result);
});

it.each(['before', 'equal', 'after'] as const)(
  'after-completion actual is nondecreasing: $0',
  async (relation) => {
    const api = await outcomeApi();
    const parent = seedOutcomeParent(fixture, { window: 2_592_000_000 });
    const pending = seedOccurrence(fixture, parent);
    const firstActual = pending.deadline;
    api.complete(
      fixture.human,
      'alpha',
      parent.id,
      outcomeInput(fixture, parent.id, selection([pending], firstActual)),
    );
    const successor = occurrenceRows(fixture, parent.id).filter((row) => row.id !== pending.id);
    expect(successor).toHaveLength(1);
    fixture.clock.advanceBy(7_200_000);
    const actual = firstActual + (relation === 'before' ? -1 : relation === 'equal' ? 0 : 1);
    const before = outcomeSnapshot(fixture);
    const action = () =>
      api.complete(
        fixture.human,
        'alpha',
        parent.id,
        outcomeInput(fixture, parent.id, selection(successor, actual)),
      );
    if (relation === 'before') {
      expect(action).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(outcomeSnapshot(fixture)).toEqual(before);
    } else {
      assertOutcomeCommit(fixture, action());
      expect(
        occurrenceRows(fixture, parent.id).find((row) => row.id === successor[0]?.id),
      ).toMatchObject({ actual_completed_at: actual, state: 'completed' });
    }
  },
);

it('calendar obligations can complete out of actual order and change only selected IDs', async () => {
  const api = await outcomeApi();
  const parent = seedOutcomeParent(fixture, { mode: 'calendar', window: 2_592_000_000 });
  const earlier = seedOccurrence(fixture, parent, { deadline: parent.deadline - 86_400_000 });
  const later = seedOccurrence(fixture, parent);
  const untouched = seedOccurrence(fixture, parent, { deadline: parent.deadline + 86_400_000 });
  api.complete(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, selection([later], parent.deadline)),
  );
  api.complete(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, selection([earlier], parent.deadline - 86_400_000)),
  );
  expect(occurrenceRows(fixture, parent.id).find((row) => row.id === untouched.id)).toEqual(
    untouched,
  );
});

const outcomes = ['complete', 'cancel'] as const;
it.each(outcomes)(
  '%s succeeds with immutable receipt/audit and exact replay before stale guards',
  async (kind) => {
    const api = await outcomeApi();
    const parent = seedOutcomeParent(fixture, {
      status: kind === 'cancel' ? 'paused' : 'active',
      deadline: fixture.clock.now() + 3_600_000,
    });
    const selected = seedOccurrence(fixture, parent);
    const payload =
      kind === 'cancel'
        ? { ...selection([selected]), reason: 'Снято по решению владельца' }
        : selection([selected]);
    const input = outcomeInput(fixture, parent.id, payload);
    if (kind === 'cancel') delete input.expected_settings_revision;
    const result = api[kind](fixture.human, 'alpha', parent.id, input);
    const committed = outcomeSnapshot(fixture);
    assertOutcomeCommit(fixture, result);
    expect(parentRevision(fixture, parent.id)).toBeGreaterThan(input.expected_revision ?? 0);
    fixture.clock.advanceBy(3000);
    expect(api[kind](fixture.human, 'alpha', parent.id, input)).toEqual(result);
    expect(outcomeSnapshot(fixture)).toEqual(committed);
    const changed = {
      ...input,
      payload: {
        ...payload,
        occurrences: [{ id: selected.id, expected_revision: selected.revision + 1 }],
      },
    };
    expect(() => api[kind](fixture.human, 'alpha', parent.id, changed)).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
    );
    expect(() => api[kind](fixture.agent('alpha'), 'alpha', parent.id, input)).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
    );
    expect(() => api[kind](fixture.human, 'beta', parent.id, input)).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
    );
    expect(outcomeSnapshot(fixture)).toEqual(committed);
  },
);

const guards = [
  'epoch',
  'entity',
  'config',
  'occurrence',
  'scope',
  'actor',
  'missing-project',
  'missing-parent',
] as const;
it.each(outcomes.flatMap((kind) => guards.map((guard) => ({ kind, guard }))))(
  '$kind rejects $guard without partial state, audits or receipt',
  async ({ kind, guard }) => {
    const api = await outcomeApi();
    const parent = seedOutcomeParent(fixture, {
      status: kind === 'cancel' ? 'paused' : 'active',
      deadline: fixture.clock.now() + 60_000,
    });
    const row = seedOccurrence(fixture, parent);
    const input = outcomeInput(
      fixture,
      parent.id,
      kind === 'cancel' ? { ...selection([row]), reason: 'План изменился' } : selection([row]),
    );
    let slug = 'alpha';
    let context = fixture.human;
    let code = 'REVISION_CONFLICT';
    if (guard === 'epoch') {
      input.database_epoch = randomUUID();
      code = 'DATABASE_EPOCH_CONFLICT';
    }
    if (guard === 'entity') input.expected_revision = (input.expected_revision ?? 0) + 1;
    if (guard === 'config') {
      input.expected_config_revision = 2;
      code = 'CONFIG_CONFLICT';
    }
    if (guard === 'occurrence')
      input.payload = {
        ...selection([{ ...row, revision: row.revision + 1 }]),
        ...(kind === 'cancel' ? { reason: 'План изменился' } : {}),
      };
    if (guard === 'scope') {
      slug = 'beta';
      code = 'PROJECT_MISMATCH';
    }
    if (guard === 'actor') {
      context = fixture.agent('beta');
      code = 'VALIDATION_ERROR';
    }
    if (guard === 'missing-project') {
      slug = 'absent';
      code = 'PROJECT_NOT_FOUND';
    }
    const target = guard === 'missing-parent' ? randomUUID() : parent.id;
    if (guard === 'missing-parent') code = 'TASK_NOT_FOUND';
    const before = outcomeSnapshot(fixture);
    expect(() => api[kind](context, slug, target, input)).toThrowError(
      expect.objectContaining({ code }),
    );
    expect(outcomeSnapshot(fixture)).toEqual(before);
  },
);

it.each(['missing', 'stale'] as const)(
  'completion rejects $0 settings precondition atomically',
  async (kind) => {
    const api = await outcomeApi();
    const parent = seedOutcomeParent(fixture);
    const row = seedOccurrence(fixture, parent);
    const input = outcomeInput(fixture, parent.id, selection([row]));
    if (kind === 'missing') delete input.expected_settings_revision;
    else input.expected_settings_revision = 2;
    const before = outcomeSnapshot(fixture);
    expect(() => api.complete(fixture.human, 'alpha', parent.id, input)).toThrowError(
      expect.objectContaining({
        code: kind === 'missing' ? 'VALIDATION_ERROR' : 'CONFIG_CONFLICT',
      }),
    );
    expect(outcomeSnapshot(fixture)).toEqual(before);
  },
);

it.each(outcomes)('%s epoch validation precedes even exact replay', async (kind) => {
  const api = await outcomeApi();
  const parent = seedOutcomeParent(fixture, {
    status: kind === 'cancel' ? 'paused' : 'active',
    deadline: fixture.clock.now() + 60_000,
  });
  const row = seedOccurrence(fixture, parent);
  const input = outcomeInput(
    fixture,
    parent.id,
    kind === 'cancel' ? { ...selection([row]), reason: 'Отмена' } : selection([row]),
  );
  api[kind](fixture.human, 'alpha', parent.id, input);
  fixture.connection.sqlite
    .prepare('UPDATE application_state SET database_epoch = ? WHERE id = 1')
    .run(randomUUID());
  const before = outcomeSnapshot(fixture);
  expect(() => api[kind](fixture.human, 'alpha', parent.id, input)).toThrowError(
    expect.objectContaining({ code: 'DATABASE_EPOCH_CONFLICT' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

const badBatches = [
  'other-parent',
  'other-project',
  'stale-selected',
  'missing-selected',
  'duplicate',
  'empty',
] as const;
it.each(outcomes.flatMap((kind) => badBatches.map((invalid) => ({ kind, invalid }))))(
  '$kind validates all selected rows before writing: $invalid',
  async ({ kind, invalid }) => {
    const api = await outcomeApi();
    const status = kind === 'cancel' ? 'paused' : 'active';
    const parent = seedOutcomeParent(fixture, {
      status,
      mode: 'calendar',
      deadline: fixture.clock.now() + 60_000,
    });
    const valid = seedOccurrence(fixture, parent);
    const other = seedOutcomeParent(fixture, {
      status,
      slug: invalid === 'other-project' ? 'beta' : 'alpha',
      deadline: parent.deadline,
    });
    const foreign = seedOccurrence(fixture, other);
    let rows = [valid, foreign];
    if (invalid === 'stale-selected')
      rows = [
        valid,
        { ...seedOccurrence(fixture, parent, { deadline: parent.deadline + 1 }), revision: 99 },
      ];
    if (invalid === 'missing-selected') rows = [valid, { ...valid, id: randomUUID() }];
    if (invalid === 'duplicate') rows = [valid, valid];
    if (invalid === 'empty') rows = [];
    const payload =
      kind === 'cancel' ? { ...selection(rows), reason: 'Выборочная отмена' } : selection(rows);
    const before = outcomeSnapshot(fixture);
    expect(() =>
      api[kind](fixture.human, 'alpha', parent.id, outcomeInput(fixture, parent.id, payload)),
    ).toThrow();
    expect(outcomeSnapshot(fixture)).toEqual(before);
  },
);

it.each(outcomes)(
  '%s advances selected mixed rows atomically and leaves unselected row untouched',
  async (kind) => {
    const api = await outcomeApi();
    const parent = seedOutcomeParent(fixture, {
      mode: 'calendar',
      status: kind === 'cancel' ? 'paused' : 'active',
      deadline: fixture.clock.now() + 60_000,
    });
    const first = seedOccurrence(fixture, parent);
    const second = seedOccurrence(fixture, parent, {
      deadline: kind === 'complete' ? fixture.clock.now() - 1 : parent.deadline + 1,
      ...(kind === 'complete' ? { state: 'debt' } : {}),
    });
    const untouched = seedOccurrence(fixture, parent, { deadline: parent.deadline + 2 });
    const result = api[kind](
      fixture.human,
      'alpha',
      parent.id,
      outcomeInput(
        fixture,
        parent.id,
        kind === 'cancel'
          ? { ...selection([first, second]), reason: 'Причина сохранена дословно  ' }
          : selection([first, second]),
      ),
    );
    const rows = occurrenceRows(fixture, parent.id);
    expect(rows.find((row) => row.id === first.id)).toMatchObject({
      state: kind === 'cancel' ? 'cancelled' : 'completed',
      revision: first.revision + 1,
    });
    expect(rows.find((row) => row.id === second.id)).toMatchObject({
      state: kind === 'cancel' ? 'cancelled' : 'completed_late',
      revision: second.revision + 1,
    });
    expect(rows.find((row) => row.id === untouched.id)).toEqual(untouched);
    if (kind === 'cancel')
      expect(rows.find((row) => row.id === first.id)).toMatchObject({
        cancel_reason: 'Причина сохранена дословно  ',
        cancelled_at: fixture.clock.now(),
        actual_completed_at: null,
      });
    const events = assertOutcomeCommit(fixture, result);
    if (kind === 'cancel')
      expect(events.flatMap((event) => JSON.parse(event.changes))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'state', before: 'pending', after: 'cancelled' }),
        ]),
      );
  },
);

it.each(
  outcomes.flatMap((kind) =>
    ['audit_records', 'operation_receipts'].map((table) => ({ kind, table })),
  ),
)(
  '$kind rolls back occurrences, parent, successor, audit and receipt on $table failure',
  async ({ kind, table }) => {
    const api = await outcomeApi();
    const parent = seedOutcomeParent(fixture, {
      status: kind === 'cancel' ? 'paused' : 'active',
      deadline: fixture.clock.now() + 60_000,
    });
    const row = seedOccurrence(fixture, parent);
    const input = outcomeInput(
      fixture,
      parent.id,
      kind === 'cancel' ? { ...selection([row]), reason: 'Отмена' } : selection([row]),
    );
    const before = outcomeSnapshot(fixture);
    fixture.connection.sqlite
      .exec(`CREATE TRIGGER outcome_persistence_failure BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'injected outcome persistence failure'); END`);
    expect(() => api[kind](fixture.human, 'alpha', parent.id, input)).toThrow();
    expect(outcomeSnapshot(fixture)).toEqual(before);
    fixture.connection.sqlite.exec('DROP TRIGGER outcome_persistence_failure');
    assertOutcomeCommit(fixture, api[kind](fixture.human, 'alpha', parent.id, input));
  },
);

it('worker-not-run miss plus late completion rolls back even after first logical event was inserted', async () => {
  const api = await outcomeApi();
  const parent = seedOutcomeParent(fixture);
  const row = seedOccurrence(fixture, parent);
  fixture.clock.advanceBy(1);
  const input = outcomeInput(fixture, parent.id, selection([row]));
  const before = outcomeSnapshot(fixture);
  fixture.connection.sqlite
    .exec(`CREATE TRIGGER outcome_second_event_failure BEFORE INSERT ON audit_records
    WHEN NEW.operation_id = '${input.operation_id}' AND EXISTS
    (SELECT 1 FROM audit_records WHERE operation_id = NEW.operation_id)
    BEGIN SELECT RAISE(ABORT, 'injected second logical event failure'); END`);
  expect(() => api.complete(fixture.human, 'alpha', parent.id, input)).toThrow();
  expect(outcomeSnapshot(fixture)).toEqual(before);
  fixture.connection.sqlite.exec('DROP TRIGGER outcome_second_event_failure');
  const events = assertOutcomeCommit(
    fixture,
    api.complete(fixture.human, 'alpha', parent.id, input),
  );
  expect(events.filter((event) => event.entity_id === row.id)).toHaveLength(2);
});

it.each(outcomes)(
  '%s rejects a new operation against an already finalized occurrence',
  async (kind) => {
    const api = await outcomeApi();
    const parent = seedOutcomeParent(fixture, {
      status: kind === 'cancel' ? 'paused' : 'active',
      deadline: fixture.clock.now() + 60_000,
    });
    const row = seedOccurrence(fixture, parent);
    const payload =
      kind === 'cancel' ? { ...selection([row]), reason: 'Отмена' } : selection([row]);
    api[kind](fixture.human, 'alpha', parent.id, outcomeInput(fixture, parent.id, payload));
    const current = occurrenceRows(fixture, parent.id).filter((item) => item.id === row.id);
    const before = outcomeSnapshot(fixture);
    expect(() =>
      api[kind](
        fixture.human,
        'alpha',
        parent.id,
        outcomeInput(
          fixture,
          parent.id,
          kind === 'cancel' ? { ...selection(current), reason: 'Отмена' } : selection(current),
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(outcomeSnapshot(fixture)).toEqual(before);
  },
);

it.each(
  outcomes.flatMap((kind) =>
    ['missing-entity', 'missing-config'].map((guard) => ({ kind, guard })),
  ),
)('$kind requires $guard guard', async ({ kind, guard }) => {
  const api = await outcomeApi();
  const parent = seedOutcomeParent(fixture, {
    status: kind === 'cancel' ? 'paused' : 'active',
    deadline: fixture.clock.now() + 60_000,
  });
  const row = seedOccurrence(fixture, parent);
  const input = outcomeInput(
    fixture,
    parent.id,
    kind === 'cancel' ? { ...selection([row]), reason: 'Отмена' } : selection([row]),
  );
  if (guard === 'missing-entity') delete input.expected_revision;
  else delete input.expected_config_revision;
  const before = outcomeSnapshot(fixture);
  expect(() => api[kind](fixture.human, 'alpha', parent.id, input)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

it('future actual rejects a whole completion batch including earlier valid selection', async () => {
  const api = await outcomeApi();
  const parent = seedOutcomeParent(fixture, { mode: 'calendar' });
  const valid = seedOccurrence(fixture, parent);
  const invalid = seedOccurrence(fixture, parent, { deadline: parent.deadline + 1 });
  const payload = {
    occurrences: [
      ...selection([valid]).occurrences,
      {
        id: invalid.id,
        expected_revision: invalid.revision,
        actual_completed_at: formatTimestamp(fixture.clock.now() + 1),
      },
    ],
  };
  const before = outcomeSnapshot(fixture);
  expect(() =>
    api.complete(fixture.human, 'alpha', parent.id, outcomeInput(fixture, parent.id, payload)),
  ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

const cancelInvalid = [
  'active',
  'past',
  'equal',
  'debt',
  'missed',
  'empty-reason',
  'blank-reason',
  'missing-reason',
] as const;
it.each(cancelInvalid)('cancel refuses $0 and never forgives existing work', async (invalid) => {
  const api = await outcomeApi();
  const now = fixture.clock.now();
  const parent = seedOutcomeParent(fixture, {
    status: invalid === 'active' ? 'active' : 'paused',
    mode: 'calendar',
    deadline: now + 60_000,
  });
  const valid = seedOccurrence(fixture, parent);
  const bad = seedOccurrence(fixture, parent, {
    deadline:
      invalid === 'past' || invalid === 'debt' || invalid === 'missed'
        ? now - 1
        : invalid === 'equal'
          ? now
          : now + 60_001,
    ...(invalid === 'debt' || invalid === 'missed' ? { state: invalid } : {}),
  });
  const reason =
    invalid === 'empty-reason' ? '' : invalid === 'blank-reason' ? '  \n ' : 'План отменён';
  const before = outcomeSnapshot(fixture);
  expect(() =>
    api.cancel(
      fixture.human,
      'alpha',
      parent.id,
      outcomeInput(fixture, parent.id, {
        ...selection([valid, bad]),
        ...(invalid === 'missing-reason' ? {} : { reason }),
      }),
    ),
  ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

it('paused completion closes work without creating successor or releasing parent marker', async () => {
  const api = await outcomeApi();
  const parent = seedOutcomeParent(fixture, { status: 'paused', emoji: '🧪' });
  const row = seedOccurrence(fixture, parent);
  const reservations = fixture.connection.sqlite
    .prepare('SELECT * FROM task_emoji_reservations WHERE task_id = ?')
    .all(parent.id);
  const result = api.complete(
    fixture.human,
    'alpha',
    parent.id,
    outcomeInput(fixture, parent.id, selection([row])),
  );
  expect(occurrenceRows(fixture, parent.id)).toHaveLength(1);
  expect(occurrenceRows(fixture, parent.id)[0]).toMatchObject({ state: 'completed' });
  expect(
    fixture.connection.sqlite
      .prepare('SELECT * FROM task_emoji_reservations WHERE task_id = ?')
      .all(parent.id),
  ).toEqual(reservations);
  assertOutcomeCommit(fixture, result);
});

it('outcome fixture stores owned snapshots and keeps real foreign keys enabled', () => {
  const parent = seedOutcomeParent(fixture, { emoji: '🧪' });
  const row = seedOccurrence(fixture, parent);
  expect(fixture.connection.sqlite.pragma('foreign_key_check')).toEqual([]);
  expect(JSON.parse(row.schedule_snapshot)).toMatchObject({
    generation_id: parent.generation,
    generation_number: 1,
    timezone: 'Europe/Moscow',
    schedule: parent.schedule,
    first_deadline: formatTimestamp(parent.deadline),
    miss_policy: parent.policy,
    confirmation_window_ms: parent.window,
  });
  expect(
    fixture.connection.sqlite
      .prepare('SELECT task_id FROM task_emoji_reservations WHERE task_id = ?')
      .pluck()
      .get(parent.id),
  ).toBe(parent.id);
});
