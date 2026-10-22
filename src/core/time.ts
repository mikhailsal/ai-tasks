import { Temporal } from '@js-temporal/polyfill';
import { timestampSchema, timezoneSchema } from '../schema/values.js';
import { domainError } from './errors.js';

const earliestTimestamp = -62_167_219_200_000;
const latestTimestamp = 253_402_300_799_999;

function validateInstant(value: number): number {
  if (!Number.isInteger(value) || value < earliestTimestamp || value > latestTimestamp) {
    throw domainError(
      'VALIDATION_ERROR',
      'Time must be integer milliseconds within years 0000–9999',
    );
  }
  return value;
}

export function parseTimestamp(value: unknown): number {
  const parsed = timestampSchema.safeParse(value);
  if (!parsed.success) {
    throw domainError(
      'VALIDATION_ERROR',
      'Timestamp must be RFC3339 with an offset and at most millisecond precision',
    );
  }
  try {
    return validateInstant(Temporal.Instant.from(parsed.data).epochMilliseconds);
  } catch {
    throw domainError('VALIDATION_ERROR', 'Timestamp is outside the supported date range');
  }
}

export function formatTimestamp(value: number): string {
  return new Date(validateInstant(value)).toISOString();
}

export function readClock(now: () => number): number {
  return validateInstant(now());
}

/** Explicit offsets select a valid fold branch; gaps always require caller correction. */
export function resolveUserLocalTime(options: {
  localDateTime: string;
  timezone: string;
  offset?: string;
}): number {
  const { localDateTime, timezone, offset } = options;
  const preciseLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;
  if (
    !preciseLocal.test(localDateTime) ||
    !timezoneSchema.safeParse(timezone).success ||
    (offset !== undefined && !/^(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(offset))
  ) {
    throw domainError('VALIDATION_ERROR', 'Local time, timezone, or offset is invalid');
  }
  try {
    const instant =
      offset === undefined
        ? Temporal.PlainDateTime.from(localDateTime, { overflow: 'reject' }).toZonedDateTime(
            timezone,
            { disambiguation: 'reject' },
          )
        : Temporal.ZonedDateTime.from(`${localDateTime}${offset}[${timezone}]`, {
            disambiguation: 'reject',
            offset: 'reject',
            overflow: 'reject',
          });
    return validateInstant(instant.epochMilliseconds);
  } catch {
    throw domainError(
      'VALIDATION_ERROR',
      'Local time must exist and identify one instant with a matching offset',
    );
  }
}
