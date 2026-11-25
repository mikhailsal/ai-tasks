import { describe, expect, it } from 'vitest';
import {
  occurrenceMoment,
  shortLocalTime,
  windowLabel,
} from '../../web/src/screens/occurrence-model.js';

describe('occurrence times for people (QA F7)', () => {
  it('shows a moment in the task time zone, to the minute', () => {
    expect(occurrenceMoment('2026-11-19T05:00:00.000Z', 'Europe/Moscow')).toBe(
      '19 нояб. 2026 г., 08:00',
    );
    expect(occurrenceMoment('2026-11-19T05:00:07.000Z', 'Europe/Moscow')).toBe(
      '19 нояб. 2026 г., 08:00:07',
    );
  });
  it.each([
    ['08:00:00.000', '08:00'],
    ['08:00:00', '08:00'],
    ['08:00', '08:00'],
    ['13:02:03.123', '13:02:03.123'],
    ['13:02:03.000', '13:02:03'],
    ['08:00:00.500', '08:00:00.500'],
  ])('local time %s reads %s', (time, label) => {
    expect(shortLocalTime(time)).toBe(label);
  });
  it('keeps milliseconds and shows an unformattable value as stored', () => {
    expect(occurrenceMoment('2026-11-19T05:00:00.500Z', 'Europe/Moscow')).toBe(
      '19 нояб. 2026 г., 08:00:00,500',
    );
    expect(occurrenceMoment('2026-11-19T05:00:00.000Z', 'Not/AZone')).toBe(
      '2026-11-19T05:00:00.000Z',
    );
  });
  it.each([
    [0, 'нет'],
    [-1, '-1 мс'],
    [5400000, '1 ч 30 мин'],
    [86400000, '1 сут.'],
    [2592000000, '30 сут.'],
    [1500, '1.5 с'],
  ])('window %d ms reads %s', (ms, label) => {
    expect(windowLabel(ms)).toBe(label);
  });
});
