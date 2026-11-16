import { expect, it } from 'vitest';
import { dayCount, occurrenceDay } from '../../src/core/recurrence/day.js';

/** SC-001 boundary table: each case names the day a person expects. */
const cases: [string, string, string, number, string][] = [
  ['midnight default, late evening', '2026-11-10T20:59:59.999Z', 'Europe/Moscow', 0, '2026-11-10'],
  [
    'midnight default, exactly midnight',
    '2026-11-10T21:00:00.000Z',
    'Europe/Moscow',
    0,
    '2026-11-11',
  ],
  ['04:00 rule, night after 03:30', '2026-11-11T00:30:00.000Z', 'Europe/Moscow', 4, '2026-11-10'],
  ['04:00 rule, exactly at start', '2026-11-11T01:00:00.000Z', 'Europe/Moscow', 4, '2026-11-11'],
  ['04:00 rule, evening 23:40', '2026-11-10T20:40:00.000Z', 'Europe/Moscow', 4, '2026-11-10'],
  ['23:00 rule, 22:59', '2026-11-10T19:59:00.000Z', 'Europe/Moscow', 23, '2026-11-09'],
  ['23:00 rule, 23:00', '2026-11-10T20:00:00.000Z', 'Europe/Moscow', 23, '2026-11-10'],
  ['UTC zone, 04:00 rule', '2026-11-10T03:59:00.000Z', 'UTC', 4, '2026-11-09'],
  // Berlin spring forward: 2026-03-29 has 23 hours (02:00 → 03:00).
  ['23 hour day, 01:30 before jump', '2026-03-29T00:30:00.000Z', 'Europe/Berlin', 4, '2026-03-28'],
  ['23 hour day, 03:30 after jump', '2026-03-29T01:30:00.000Z', 'Europe/Berlin', 4, '2026-03-28'],
  ['23 hour day, 04:00 start', '2026-03-29T02:00:00.000Z', 'Europe/Berlin', 4, '2026-03-29'],
  // Berlin fall back: 2026-10-25 has 25 hours (03:00 → 02:00 again).
  ['25 hour day, second 02:30', '2026-10-25T01:30:00.000Z', 'Europe/Berlin', 3, '2026-10-24'],
  ['25 hour day, 03:00 start', '2026-10-25T02:00:00.000Z', 'Europe/Berlin', 3, '2026-10-25'],
];

it.each(cases)('%s', (...[, deadline, zone, hour, expected]) => {
  expect(occurrenceDay(Date.parse(deadline), zone, hour)).toBe(expected);
});

it('counts days inclusively', () => {
  expect(dayCount('2026-11-01', '2026-11-07')).toBe(7);
  expect(dayCount('2026-11-07', '2026-11-01')).toBe(-5);
});
