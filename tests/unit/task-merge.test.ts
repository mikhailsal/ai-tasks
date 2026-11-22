import { describe, expect, it } from 'vitest';
import { mergeTaskFields, taskFieldsSchema } from '../../web/src/screens/task-model.js';

const base = taskFieldsSchema.parse({
  title: 'Задача',
  description: '',
  emoji: '📝',
  priority: null,
  deadline: { date: '2026-12-01', time: '10:00', offset: '' },
  timezone: 'UTC',
});

describe('task conflict merge keeps a deadline with its timezone', () => {
  it('keeps the zone I entered an edited deadline in', () => {
    const mine = { ...base, deadline: { ...base.deadline, time: '11:00' } };
    const current = { ...base, title: 'Чужое', timezone: 'America/New_York' };
    const merged = mergeTaskFields(mine, base, current);
    expect(merged).toMatchObject({ title: 'Чужое', timezone: 'UTC' });
    expect(merged.deadline.time).toBe('11:00');
  });
  it('takes the new zone when I did not touch timing', () => {
    const mine = { ...base, title: 'Моё' };
    const current = { ...base, timezone: 'America/New_York' };
    expect(mergeTaskFields(mine, base, current)).toMatchObject({
      title: 'Моё',
      timezone: 'America/New_York',
    });
  });
});
