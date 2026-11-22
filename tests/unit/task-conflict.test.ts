import { describe, expect, it } from 'vitest';
import { taskConflictView } from '../../web/src/screens/task-conflict.js';
import { taskFieldsSchema } from '../../web/src/screens/task-model.js';

const fields = (time: string, offset = '') =>
  taskFieldsSchema.parse({
    title: 'Задача',
    description: '',
    emoji: '📝',
    priority: null,
    deadline: { date: '2026-10-25', time, offset },
    timezone: 'Europe/Berlin',
  });

describe('the conflict comparison keeps deadlines that differ apart', () => {
  it.each([
    ['10:00:00.000', '', '2026-10-25 10:00'],
    ['10:00:30.000', '', '2026-10-25 10:00:30'],
    ['10:00:30.250', '', '2026-10-25 10:00:30.250'],
    ['02:30', '+02:00', '2026-10-25 02:30 (UTC+02:00)'],
  ])('%s %s → %s', (time, offset, shown) => {
    expect(taskConflictView(fields(time, offset)).deadline).toBe(shown);
  });
  it('tells the two instants of a repeated local hour apart', () => {
    expect(taskConflictView(fields('02:30', '+02:00')).deadline).not.toBe(
      taskConflictView(fields('02:30', '+01:00')).deadline,
    );
  });
});
