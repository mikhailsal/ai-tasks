import { expect, it } from 'vitest';
import { localTimeOf } from '../../src/core/recurrence/derive-local-time.js';

/** Spec 012 R2: the local time of an instant, including days of 23 and 25 hours. */
it.each([
  ['2026-11-17T17:30:00.000Z', 'Europe/Moscow', '20:30:00.000'],
  ['2026-03-29T00:59:59.999Z', 'Europe/Berlin', '01:59:59.999'],
  ['2026-03-29T01:00:00.000Z', 'Europe/Berlin', '03:00:00.000'],
  ['2026-10-25T00:30:00.000Z', 'Europe/Berlin', '02:30:00.000'],
  ['2026-10-25T01:30:00.000Z', 'Europe/Berlin', '02:30:00.000'],
  ['2026-11-01T06:15:00.123Z', 'America/New_York', '01:15:00.123'],
  ['2026-11-01T05:15:00.123Z', 'America/New_York', '01:15:00.123'],
  ['2026-01-01T00:00:00.000Z', 'UTC', '00:00:00.000'],
])('%s in %s is %s', (instant, zone, expected) => {
  expect(localTimeOf(Date.parse(instant), zone)).toBe(expected);
});
