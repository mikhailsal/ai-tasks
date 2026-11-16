import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { moveTask } from '../../src/core/shortcuts/move.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { transitionTask } from '../../src/core/tasks/transitions.js';
import { ordinaryInput, type OrdinaryFixture } from '../fixtures/ordinary-work.js';
import { lifecycleFixture } from '../fixtures/recurrence-lifecycle.js';
import { auditRows, refusal } from '../fixtures/shortcuts.js';

/** Spec 009 US2 and US3: move a task by target status, as safe as the strict form. */
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await lifecycleFixture();
});
afterEach(() => fixture.close());

function create(emoji: string) {
  const result = createTask(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { kind: 'ordinary', title: `Задача ${emoji}`, emoji }),
  );
  return z.object({ id: z.uuid() }).parse(result.data).id;
}
const task = (id: string) =>
  z
    .object({ status_id: z.string(), revision: z.number() })
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT status_id, revision FROM tasks WHERE id = ?')
        .get(id),
    );
function move(input: Record<string, string>) {
  return moveTask(fixture.human, 'alpha', input);
}

it('moves by icon with no tokens; a repeat returns the record and writes nothing (FR-002, FR-008)', () => {
  const id = create('📘');
  const before = task(id);
  const result = move({ task: '📘', to: 'planning', from: before.status_id });
  expect(task(id)).toEqual({ status_id: 'planning', revision: before.revision + 1 });
  expect(result.meta.operation_id).toEqual(expect.any(String));
  const writes = auditRows(fixture).length;
  expect(move({ task: '📘', to: 'planning' })).toMatchObject({
    ok: true,
    data: { id, status_id: 'planning', existing: true },
  });
  expect(auditRows(fixture)).toHaveLength(writes);
});

it('a different current status is refused without change (FR-007)', () => {
  const id = create('📗');
  const before = task(id);
  expect(refusal(() => move({ task: id, to: 'planning', from: 'done' }))).toMatchObject({
    code: 'VALIDATION_ERROR',
    details: { actual_status: before.status_id },
  });
  expect(task(id)).toEqual(before);
});

it('a target not allowed from the current status lists the allowed ones (FR-006)', () => {
  const id = create('📙');
  const error = refusal(() => move({ task: id, to: 'no_such_status' }));
  expect(error).toMatchObject({
    code: 'VALIDATION_ERROR',
    details: { allowed: expect.arrayContaining(['planning']) },
  });
});

it('the audit trail equals the strict transition, apart from identifiers (FR-009, SC-003)', () => {
  const strict = create('📒');
  const shortcut = create('📓');
  transitionTask(
    fixture.human,
    'alpha',
    strict,
    ordinaryInput(fixture, { to_status_id: 'planning' }, { revision: task(strict).revision }),
  );
  move({ task: shortcut, to: 'planning' });
  const [first, second] = auditRows(fixture).slice(-2);
  const shape = (row: typeof first) => ({
    action: row?.action,
    entity_type: row?.entity_type,
    changes: row?.changes
      .replaceAll(strict, 'ID')
      .replaceAll(shortcut, 'ID')
      .replaceAll(/📒|📓/gu, 'E')
      // Board positions differ only because the second task sits lower in its column.
      .replaceAll(/"position":\d+/gu, '"position":N'),
  });
  expect(shape(second)).toEqual(shape(first));
});
