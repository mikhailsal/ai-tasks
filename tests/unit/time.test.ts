import { describe, expect, it } from 'vitest';
import {
  formatTimestamp,
  parseTimestamp,
  readClock,
  resolveUserLocalTime,
} from '../../src/core/time.js';

describe('precise server time', () => {
  it('parses explicit offsets and serializes past instants as canonical UTC milliseconds', () => {
    expect(formatTimestamp(parseTimestamp('1960-01-01T03:00:00+03:00'))).toBe(
      '1960-01-01T00:00:00.000Z',
    );
    expect(formatTimestamp(parseTimestamp('2026-10-21t01:00:00.12z'))).toBe(
      '2026-10-21T01:00:00.120Z',
    );
    expect(formatTimestamp(parseTimestamp('0000-01-01T00:00:00Z'))).toBe(
      '0000-01-01T00:00:00.000Z',
    );
    expect(formatTimestamp(parseTimestamp('9999-12-31T23:59:59.999Z'))).toBe(
      '9999-12-31T23:59:59.999Z',
    );
  });

  it.each([
    null,
    0,
    '',
    '2026-10-21',
    '2026-10-21T10:00:00',
    '2026-02-30T10:00:00Z',
    '2026-10-21T10:00:00.0001Z',
    '2026-10-21T10:00:60Z',
    '0000-01-01T00:00:00+01:00',
    '9999-12-31T23:59:59-01:00',
  ])('rejects invalid or unsupported instant %j', (value) => {
    expect(() => parseTimestamp(value)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });

  it('validates every injected clock reading and canonical formatting boundary', () => {
    let instant = 123;
    const now = () => instant;
    expect(readClock(now)).toBe(123);
    instant = -123;
    expect(readClock(now)).toBe(-123);
    for (const invalid of [NaN, Infinity, 1.5, -62_167_219_200_001, 253_402_300_800_000]) {
      expect(() => readClock(() => invalid)).toThrow();
      expect(() => formatTimestamp(invalid)).toThrow();
    }
  });
});

describe('explicit user local-time resolution', () => {
  it('resolves an ordinary local time without silently assuming UTC', () => {
    expect(
      formatTimestamp(
        resolveUserLocalTime({
          localDateTime: '2026-10-21T10:00:00.123',
          timezone: 'Europe/Moscow',
        }),
      ),
    ).toBe('2026-10-21T07:00:00.123Z');
  });

  it('requires a matching explicit offset to select either branch of a DST fold', () => {
    const local = { localDateTime: '2026-11-01T01:30:00', timezone: 'America/New_York' };
    expect(() => resolveUserLocalTime(local)).toThrow();
    expect(formatTimestamp(resolveUserLocalTime({ ...local, offset: '-04:00' }))).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    expect(formatTimestamp(resolveUserLocalTime({ ...local, offset: '-05:00' }))).toBe(
      '2026-11-01T06:30:00.000Z',
    );
    expect(() => resolveUserLocalTime({ ...local, offset: '-06:00' })).toThrow();
  });

  it('rejects DST gaps even when an offset is supplied', () => {
    const local = { localDateTime: '2026-03-08T02:30:00', timezone: 'America/New_York' };
    expect(() => resolveUserLocalTime(local)).toThrow();
    expect(() => resolveUserLocalTime({ ...local, offset: '-05:00' })).toThrow();
    expect(() => resolveUserLocalTime({ ...local, offset: '-04:00' })).toThrow();
  });

  it('rejects invalid dates, zones, embedded offsets and excessive precision', () => {
    for (const localDateTime of [
      '2026-02-30T10:00:00',
      '2026-10-21T10:00:00.1234',
      '2026-10-21T10:00:00Z',
    ]) {
      expect(() => resolveUserLocalTime({ localDateTime, timezone: 'UTC' })).toThrow();
    }
    expect(() =>
      resolveUserLocalTime({ localDateTime: '2026-10-21T10:00', timezone: '+03:00' }),
    ).toThrow();
  });
});
