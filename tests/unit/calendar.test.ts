import { expect, it } from 'vitest';
import { nextCalendarDeadline } from '../../src/core/recurrence/calendar.js';
import { nextElapsedDeadline } from '../../src/core/recurrence/elapsed.js';
import type { CalendarSchedule } from '../../src/schema/recurrence-input.js';

const cases: {
  name: string;
  schedule: CalendarSchedule;
  zone: string;
  first: string;
  next: string[];
}[] = [
  {
    name: 'daily milliseconds',
    schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '09:15:30.123' },
    zone: 'Europe/Moscow',
    first: '2026-10-21T06:15:30.123Z',
    next: ['2026-10-22T06:15:30.123Z', '2026-10-23T06:15:30.123Z'],
  },
  {
    name: 'every three local days',
    schedule: { mode: 'calendar', pattern: 'days', every: 3, local_time: '09:00:00.000' },
    zone: 'Europe/Moscow',
    first: '2026-10-21T06:00:00.000Z',
    next: ['2026-10-24T06:00:00.000Z'],
  },
  {
    name: 'two weeks are fourteen local days across spring DST',
    schedule: { mode: 'calendar', pattern: 'weeks', every: 2, local_time: '09:00:00.000' },
    zone: 'Europe/Berlin',
    first: '2026-03-22T08:00:00.000Z',
    next: ['2026-04-05T07:00:00.000Z'],
  },
  {
    name: 'ISO weekdays are sorted and skip weekends',
    schedule: {
      mode: 'calendar',
      pattern: 'weekdays',
      weekdays: [5, 1, 3],
      local_time: '09:00:00.000',
    },
    zone: 'Europe/Moscow',
    first: '2026-10-23T06:00:00.000Z',
    next: ['2026-10-26T06:00:00.000Z', '2026-10-28T06:00:00.000Z', '2026-10-30T06:00:00.000Z'],
  },
  {
    name: 'ISO Sunday seven then Monday one',
    schedule: {
      mode: 'calendar',
      pattern: 'weekdays',
      weekdays: [1, 7],
      local_time: '09:00:00.000',
    },
    zone: 'Europe/Moscow',
    first: '2026-10-23T06:00:00.000Z',
    next: ['2026-10-25T06:00:00.000Z', '2026-10-26T06:00:00.000Z'],
  },
  {
    name: 'month end retains day thirty-one after short February',
    schedule: {
      mode: 'calendar',
      pattern: 'months',
      every: 1,
      day_of_month: 31,
      local_time: '09:00:00.000',
    },
    zone: 'Europe/Moscow',
    first: '2027-01-31T06:00:00.000Z',
    next: [
      '2027-02-28T06:00:00.000Z',
      '2027-03-31T06:00:00.000Z',
      '2027-04-30T06:00:00.000Z',
      '2027-05-31T06:00:00.000Z',
    ],
  },
  {
    name: 'leap February does not change requested month day',
    schedule: {
      mode: 'calendar',
      pattern: 'months',
      every: 1,
      day_of_month: 31,
      local_time: '09:00:00.000',
    },
    zone: 'UTC',
    first: '2028-01-31T09:00:00.000Z',
    next: ['2028-02-29T09:00:00.000Z', '2028-03-31T09:00:00.000Z'],
  },
  {
    name: 'month interval retains original month day',
    schedule: {
      mode: 'calendar',
      pattern: 'months',
      every: 2,
      day_of_month: 31,
      local_time: '09:00:00.000',
    },
    zone: 'UTC',
    first: '2027-01-31T09:00:00.000Z',
    next: ['2027-03-31T09:00:00.000Z', '2027-05-31T09:00:00.000Z'],
  },
  {
    name: 'annual leap day returns after three clamped years',
    schedule: {
      mode: 'calendar',
      pattern: 'months',
      every: 12,
      day_of_month: 29,
      local_time: '09:00:00.000',
    },
    zone: 'UTC',
    first: '2028-02-29T09:00:00.000Z',
    next: [
      '2029-02-28T09:00:00.000Z',
      '2030-02-28T09:00:00.000Z',
      '2031-02-28T09:00:00.000Z',
      '2032-02-29T09:00:00.000Z',
    ],
  },
  {
    name: 'Berlin spring gap shifts forward without permanently drifting local time',
    schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '02:30:00.000' },
    zone: 'Europe/Berlin',
    first: '2026-03-28T01:30:00.000Z',
    next: ['2026-03-29T01:30:00.000Z', '2026-03-30T00:30:00.000Z'],
  },
  {
    name: 'Berlin fold chooses earlier offset then resumes standard time',
    schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '02:30:00.000' },
    zone: 'Europe/Berlin',
    first: '2026-10-24T00:30:00.000Z',
    next: ['2026-10-25T00:30:00.000Z', '2026-10-26T01:30:00.000Z'],
  },
  {
    name: 'weekly fold also chooses earlier offset',
    schedule: { mode: 'calendar', pattern: 'weeks', every: 1, local_time: '02:30:00.000' },
    zone: 'Europe/Berlin',
    first: '2026-10-18T00:30:00.000Z',
    next: ['2026-10-25T00:30:00.000Z'],
  },
  {
    name: 'Lord Howe gap shifts by thirty minutes rather than one hour',
    schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '02:15:00.000' },
    zone: 'Australia/Lord_Howe',
    first: '2026-10-02T15:45:00.000Z',
    next: ['2026-10-03T15:45:00.000Z', '2026-10-04T15:15:00.000Z'],
  },
  {
    name: 'Lord Howe fold chooses earlier half-hour offset',
    schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '01:45:00.000' },
    zone: 'Australia/Lord_Howe',
    first: '2026-04-03T14:45:00.000Z',
    next: ['2026-04-04T14:45:00.000Z', '2026-04-05T15:15:00.000Z'],
  },
];

it.each(cases)('$name', ({ schedule, zone, first, next }) => {
  const calculate = nextCalendarDeadline;
  let anchor = Date.parse(first);
  const original = structuredClone(schedule);
  for (const timestamp of next) {
    const result = calculate({
      schedule,
      anchor,
      timezone: zone,
    });
    expect(result).toBe(Date.parse(timestamp));
    expect(result).toBeGreaterThan(anchor);
    anchor = result;
  }
  expect(schedule).toEqual(original);
});

it.each([
  {
    unit: 'days' as const,
    every: 1,
    actual: '2026-03-28T11:00:00.123Z',
    expected: '2026-03-29T11:00:00.123Z',
  },
  {
    unit: 'days' as const,
    every: 1,
    actual: '2026-10-24T10:00:00.123Z',
    expected: '2026-10-25T10:00:00.123Z',
  },
  {
    unit: 'hours' as const,
    every: 7,
    actual: '2026-10-21T23:59:59.999Z',
    expected: '2026-10-22T06:59:59.999Z',
  },
])(
  'completion-relative $unit every $every uses elapsed time from real actual completion',
  ({ unit, every, actual, expected }) => {
    const calculate = nextElapsedDeadline;
    expect(
      calculate({
        schedule: { mode: 'after_completion', unit, every },
        actualCompletedAt: Date.parse(actual),
      }),
    ).toBe(Date.parse(expected));
  },
);

it('maximum completion-relative interval is an exact duration with milliseconds retained', () => {
  const calculate = nextElapsedDeadline;
  const actual = Date.parse('2026-10-21T10:00:00.123Z');
  expect(
    calculate({
      schedule: { mode: 'after_completion', unit: 'days', every: 3650 },
      actualCompletedAt: actual,
    }),
  ).toBe(actual + 3650 * 86_400_000);
});

it.each([
  {
    name: 'zero interval',
    schedule: { mode: 'calendar', pattern: 'days', every: 0, local_time: '09:00:00.000' },
  },
  {
    name: 'duplicate weekdays',
    schedule: {
      mode: 'calendar',
      pattern: 'weekdays',
      weekdays: [1, 1],
      local_time: '09:00:00.000',
    },
  },
  {
    name: 'empty weekdays',
    schedule: { mode: 'calendar', pattern: 'weekdays', weekdays: [], local_time: '09:00:00.000' },
  },
  {
    name: 'imprecise local time',
    schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '09:00' },
  },
  {
    name: 'invalid month day',
    schedule: {
      mode: 'calendar',
      pattern: 'months',
      every: 1,
      day_of_month: 32,
      local_time: '09:00:00.000',
    },
  },
])('public calendar helper rejects $name with a domain validation error', ({ schedule }) => {
  expect(() =>
    Reflect.apply(nextCalendarDeadline, undefined, [
      { schedule, anchor: Date.parse('2026-10-21T06:00:00.000Z'), timezone: 'UTC' },
    ]),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
});

it.each([
  { anchor: 1.5, timezone: 'UTC' },
  { anchor: Number.NaN, timezone: 'UTC' },
  { anchor: Date.parse('2026-10-21T06:00:00.000Z'), timezone: '+03:00' },
  { anchor: Date.parse('2026-10-21T06:00:00.000Z'), timezone: 'Not/A_Zone' },
  { anchor: Date.parse('9999-12-31T09:00:00.000Z'), timezone: 'UTC' },
])(
  'public calendar helper rejects invalid inputs and date overflow ($anchor, $timezone)',
  ({ anchor, timezone }) => {
    expect(() =>
      nextCalendarDeadline({
        schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '09:00:00.000' },
        anchor,
        timezone,
      }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  },
);

it('calendar month arithmetic preserves leap day in supported Gregorian year zero', () => {
  expect(
    nextCalendarDeadline({
      schedule: {
        mode: 'calendar',
        pattern: 'months',
        every: 1,
        day_of_month: 31,
        local_time: '09:00:00.000',
      },
      anchor: Date.parse('0000-01-31T09:00:00.000Z'),
      timezone: 'UTC',
    }),
  ).toBe(Date.parse('0000-02-29T09:00:00.000Z'));
});

it('a whole-day timezone gap advances by its actual size without duplicate instants', () => {
  const schedule: CalendarSchedule = {
    mode: 'calendar',
    pattern: 'days',
    every: 1,
    local_time: '12:00:00.000',
  };
  const next = nextCalendarDeadline({
    schedule,
    anchor: Date.parse('2011-12-29T22:00:00.000Z'),
    timezone: 'Pacific/Apia',
  });
  expect(next).toBe(Date.parse('2011-12-30T22:00:00.000Z'));
  expect(nextCalendarDeadline({ schedule, anchor: next, timezone: 'Pacific/Apia' })).toBe(
    Date.parse('2011-12-31T22:00:00.000Z'),
  );
});

it.each([
  {
    actualCompletedAt: Number.POSITIVE_INFINITY,
    schedule: { mode: 'after_completion', unit: 'days', every: 1 },
  },
  { actualCompletedAt: 0.5, schedule: { mode: 'after_completion', unit: 'days', every: 1 } },
  {
    actualCompletedAt: Date.parse('9999-12-31T00:00:00.000Z'),
    schedule: { mode: 'after_completion', unit: 'days', every: 1 },
  },
  { actualCompletedAt: 0, schedule: { mode: 'after_completion', unit: 'hours', every: 3651 } },
  { actualCompletedAt: 0, schedule: { mode: 'after_completion', unit: 'weeks', every: 1 } },
])('public elapsed helper rejects invalid completion, schedule or resulting range', (input) => {
  expect(() => Reflect.apply(nextElapsedDeadline, undefined, [input])).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
});
