import { expect, it } from 'vitest';
import {
  blankRecurrenceFields,
  changeRecurrenceFirst,
  fieldsFromRecurrence,
  recurrenceFieldsSchema,
  recurrencePayload,
  type RecurrenceFields,
} from '../../web/src/screens/recurrence-fields.js';

function validFields(): RecurrenceFields {
  return {
    ...blankRecurrenceFields(),
    first: { date: '2026-10-22', time: '12:34:56.789', offset: '' },
    localTime: '12:34:56.789',
    missPolicy: 'record_miss',
    confirmationWindowMs: '0',
  };
}

it('keeps policy and window explicitly blank until chosen, including across modes', () => {
  const blank = blankRecurrenceFields();
  expect(blank.missPolicy).toBe('');
  expect(blank.confirmationWindowMs).toBe('');
  expect(recurrenceFieldsSchema.parse({ ...blank, mode: 'after_completion' })).toMatchObject({
    missPolicy: '',
    confirmationWindowMs: '',
  });
  const chosen = { ...validFields(), mode: 'after_completion' as const };
  expect(recurrencePayload(chosen, 'Europe/Moscow')).toMatchObject({
    miss_policy: 'record_miss',
    confirmation_window_ms: 0,
  });
});

it.each(['days', 'weeks', 'weekdays', 'months'] as const)(
  'submits calendar %s with exact time and appropriate fields',
  (pattern) => {
    const result = recurrencePayload(
      { ...validFields(), pattern, every: '2', weekdays: [1, 5], dayOfMonth: '31' },
      'Europe/Moscow',
    );
    expect(result.first_deadline).toBe('2026-10-22T09:34:56.789Z');
    expect(result.schedule).toEqual({
      mode: 'calendar',
      pattern,
      local_time: '12:34:56.789',
      ...(pattern === 'weekdays' ? { weekdays: [1, 5] } : { every: 2 }),
      ...(pattern === 'months' ? { day_of_month: 31 } : {}),
    });
  },
);

it.each(['hours', 'days'] as const)(
  'submits elapsed %s without irrelevant calendar fields',
  (unit) => {
    expect(
      recurrencePayload(
        { ...validFields(), mode: 'after_completion', unit, every: '3650', localTime: '' },
        'UTC',
      ).schedule,
    ).toEqual({
      mode: 'after_completion',
      every: 3650,
      unit,
    });
  },
);

it('normalizes native time controls without losing milliseconds', () => {
  for (const [input, expected] of [
    ['08:15', '08:15:00.000'],
    ['08:15:09', '08:15:09.000'],
    ['08:15:09.12', '08:15:09.120'],
  ]) {
    expect(
      recurrencePayload({ ...validFields(), localTime: input ?? '' }, 'UTC').schedule,
    ).toMatchObject({ local_time: expected });
  }
});

it('requires an explicit fold offset and rejects nonexistent local first times', () => {
  const fold = {
    ...validFields(),
    first: { date: '2026-10-25', time: '02:30:00.123', offset: '' },
  };
  expect(() => recurrencePayload(fold, 'Europe/Berlin')).toThrow(/смещение/u);
  expect(
    recurrencePayload({ ...fold, first: { ...fold.first, offset: '+01:00' } }, 'Europe/Berlin')
      .first_deadline,
  ).toBe('2026-10-25T01:30:00.123Z');
  expect(() =>
    recurrencePayload(
      { ...fold, first: { date: '2026-03-29', time: '02:30', offset: '' } },
      'Europe/Berlin',
    ),
  ).toThrow(/не существует/u);
});

it('rejects missing required choices and invalid numeric bounds without coercing blank to zero', () => {
  for (const change of [
    { first: { date: '', time: '', offset: '' } },
    { missPolicy: '' as const },
    { confirmationWindowMs: '' },
    { confirmationWindowMs: '-1' },
    { confirmationWindowMs: '2592000001' },
    { every: '0' },
    { every: '3651' },
    { every: '1.5' },
    { pattern: 'months' as const, dayOfMonth: '32' },
    { pattern: 'weekdays' as const, weekdays: [] },
    { pattern: 'weekdays' as const, weekdays: [1, 1] },
  ])
    expect(() => recurrencePayload({ ...validFields(), ...change }, 'UTC')).toThrow();
});

it('preserves incomplete numeric draft strings until explicit submit', () => {
  const incomplete = { ...validFields(), every: '', dayOfMonth: '', confirmationWindowMs: '-' };
  expect(recurrenceFieldsSchema.parse(incomplete)).toEqual(incomplete);
  expect(() => recurrencePayload(incomplete, 'UTC')).toThrow();
});

it('changes a following rule clock with first time but preserves an independently chosen clock', () => {
  const first = { date: '2026-10-23', time: '08:15', offset: '' };
  for (const localTime of ['', '12:34:56.789']) {
    expect(changeRecurrenceFirst({ ...validFields(), localTime }, first).localTime).toBe('08:15');
  }
  expect(changeRecurrenceFirst({ ...validFields(), localTime: '11:00' }, first).localTime).toBe(
    '11:00',
  );
  expect(
    changeRecurrenceFirst(
      { ...validFields(), first: { ...first, time: '08:15' }, localTime: '08:15:00.000' },
      { ...first, time: '09:00' },
    ).localTime,
  ).toBe('09:00');
});

it('round trips the original first absolute instant in another display timezone and keeps the schedule clock', () => {
  const configuration = {
    generation_id: '00000000-0000-4000-8000-000000000001',
    generation_number: 1,
    first_deadline: '2026-10-25T01:30:00.123Z',
    timezone: 'UTC',
    schedule: {
      mode: 'calendar' as const,
      pattern: 'months' as const,
      every: 3,
      day_of_month: 31,
      local_time: '09:12:34.567',
    },
    miss_policy: 'carry_forward' as const,
    confirmation_window_ms: 2592000000,
  };
  const fields = fieldsFromRecurrence(configuration, 'Europe/Berlin');
  expect(fields.first).toEqual({ date: '2026-10-25', time: '02:30:00.123', offset: '+01:00' });
  expect(recurrencePayload(fields, 'Europe/Berlin')).toEqual({
    first_deadline: configuration.first_deadline,
    schedule: configuration.schedule,
    miss_policy: configuration.miss_policy,
    confirmation_window_ms: configuration.confirmation_window_ms,
  });
});
