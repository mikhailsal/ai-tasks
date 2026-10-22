import { Temporal } from '@js-temporal/polyfill';
import { timestampSchema, timezoneSchema } from '../schema/values.js';
import { domainError } from './errors.js';

import { validateInstant } from './clock.js';
export { formatTimestamp, readClock } from './clock.js';

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
