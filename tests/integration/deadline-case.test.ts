import { afterEach, beforeEach, expect, it } from 'vitest';
import { createProject } from '../../src/core/projects/commands.js';
import { createTask, updateTask } from '../../src/core/tasks/commands.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
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

it.each(['create', 'update'] as const)(
  '%s accepts lowercase RFC3339 and returns canonical UTC',
  (command) => {
    const task = taskDetailSchema.parse(
      createTask(
        fixture.human,
        'alpha',
        ordinaryInput(fixture, { kind: 'ordinary', title: 'Существующая задача' }),
      ).data,
    );
    if (command === 'update') {
      const updated = updateTask(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(
          fixture,
          { deadline: '2026-10-21t13:20:30.456+03:00' },
          { revision: task.revision },
        ),
      );
      expect(taskDetailSchema.parse(updated.data).deadline).toBe('2026-10-21T10:20:30.456Z');
      return;
    }
    const created = createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, {
        kind: 'ordinary',
        title: 'Точная дата',
        deadline: '2026-10-21t10:20:30.123z',
      }),
    );
    expect(taskDetailSchema.parse(created.data).deadline).toBe('2026-10-21T10:20:30.123Z');
  },
);

it('retains original deadline spelling in mutation identity without changing the submitted envelope', () => {
  const input = ordinaryInput(fixture, {
    kind: 'ordinary',
    title: 'Идентичность запроса',
    deadline: '2026-10-21t10:20:30.123z',
  });
  const original = structuredClone(input);
  const result = createTask(fixture.human, 'alpha', input);
  const committed = ordinarySnapshot(fixture);
  expect(input).toEqual(original);
  expect(createTask(fixture.human, 'alpha', input)).toEqual(result);
  expect(() =>
    createTask(fixture.human, 'alpha', {
      ...input,
      payload: {
        kind: 'ordinary',
        title: 'Идентичность запроса',
        deadline: '2026-10-21T10:20:30.123Z',
      },
    }),
  ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  expect(ordinarySnapshot(fixture)).toEqual(committed);
});

it.each([
  '2026-10-21',
  '2026-10-21t10:20:30',
  '2026-02-30t10:20:30z',
  '2026-10-21t10:20:30.1234z',
  '0000-01-01t00:00:00+01:00',
  '9999-12-31t23:59:59-01:00',
])('still rejects invalid or out-of-range deadline %s atomically', (deadline) => {
  const task = taskDetailSchema.parse(
    createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { kind: 'ordinary', title: 'Неизменная задача' }),
    ).data,
  );
  const before = ordinarySnapshot(fixture);
  expect(() =>
    createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { kind: 'ordinary', title: 'Неверная дата', deadline }),
    ),
  ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(ordinarySnapshot(fixture)).toEqual(before);
  expect(() =>
    updateTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, { deadline }, { revision: task.revision }),
    ),
  ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(ordinarySnapshot(fixture)).toEqual(before);
});
