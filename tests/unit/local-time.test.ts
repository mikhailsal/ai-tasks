import { describe, expect, it } from 'vitest';
import {
  compactTime,
  deadlineDraft,
  localTimeChoices,
  resolveLocalDeadline,
  timeStep,
} from '../../web/src/data/local-time.js';
import { fits, windowUnit } from '../../web/src/components/window-units.js';

describe('browser native-Intl precise local deadlines', () => {
  it('preserves milliseconds and existing offset when editing an exact saved deadline', () => {
    const value = { date: '2026-11-01', time: '12:34:56.789', offset: '' };
    const instant = resolveLocalDeadline(value, 'Europe/Moscow');
    expect(instant).toBe('2026-11-01T09:34:56.789Z');
    expect(deadlineDraft(instant, 'Europe/Moscow')).toEqual({ ...value, offset: '+03:00' });
    expect(resolveLocalDeadline({ date: '', time: '', offset: '' }, 'Europe/Moscow')).toBeNull();
  });
  it('rejects nonexistent Berlin wall time without silently advancing it', () => {
    const gap = { date: '2026-03-29', time: '02:30:00.000', offset: '' };
    expect(localTimeChoices(gap, 'Europe/Berlin')).toEqual([]);
    expect(() => resolveLocalDeadline(gap, 'Europe/Berlin')).toThrow(/не существует/u);
  });
  it('requires an explicit fold branch and preserves both choices across edit round trips', () => {
    const fold = { date: '2026-10-25', time: '02:30:00.123', offset: '' };
    expect(localTimeChoices(fold, 'Europe/Berlin').map((value) => value.offset)).toEqual([
      '+02:00',
      '+01:00',
    ]);
    expect(() => resolveLocalDeadline(fold, 'Europe/Berlin')).toThrow(/смещение/u);
    for (const [offset, instant] of [
      ['+02:00', '2026-10-25T00:30:00.123Z'],
      ['+01:00', '2026-10-25T01:30:00.123Z'],
    ]) {
      expect(resolveLocalDeadline({ ...fold, offset: offset ?? '' }, 'Europe/Berlin')).toBe(
        instant,
      );
      expect(deadlineDraft(instant ?? '', 'Europe/Berlin')).toEqual({ ...fold, offset });
    }
  });
  it.each([
    { date: '2026-02-30', time: '12:00', offset: '' },
    { date: '2026-01-01', time: '24:01', offset: '' },
    { date: '2026-01-01', time: '12:00:00.1234', offset: '' },
    { date: '2026-01-01', time: '', offset: '' },
  ])('rejects invalid or incomplete local input %j', (value) => {
    expect(() => resolveLocalDeadline(value, 'Europe/Moscow')).toThrow();
  });
});

describe('time precision people need (QA F10)', () => {
  it.each([
    ['08:00:00.000', '08:00', '60'],
    ['08:00:30.000', '08:00:30', '1'],
    ['13:02:03.123', '13:02:03.123', '0.001'],
    ['08:00', '08:00', '60'],
  ])('%s shows as %s with step %s', (time, shown, step) => {
    expect(compactTime(time)).toBe(shown);
    expect(timeStep(shown)).toBe(step);
  });
  it('fills a whole-minute deadline as HH:MM', () => {
    expect(deadlineDraft('2026-11-19T05:00:00.000Z', 'Europe/Moscow').time).toBe('08:00');
  });
  it.each([
    ['', 'minute'],
    ['0', 'minute'],
    ['2592000000', 'day'],
    ['5400000', 'minute'],
    ['7200000', 'hour'],
    ['123456', 'ms'],
  ])('a window of %s ms is shown in %s', (ms, unit) => {
    expect(windowUnit(ms)).toBe(unit);
  });
  it('a value set from outside leaves a unit that cannot show it whole', () => {
    expect(fits('5400000', 'minute')).toBe(true);
    expect(fits('5400000', 'hour')).toBe(false);
    expect(fits('123456', 'minute')).toBe(false);
    expect(fits('', 'day')).toBe(true);
  });
});
