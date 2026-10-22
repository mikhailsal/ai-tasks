import { domainError } from './errors.js';

const earliestTimestamp = -62_167_219_200_000;
const latestTimestamp = 253_402_300_799_999;

export function validateInstant(value: number): number {
  if (!Number.isInteger(value) || value < earliestTimestamp || value > latestTimestamp) {
    throw domainError(
      'VALIDATION_ERROR',
      'Time must be integer milliseconds within years 0000–9999',
    );
  }
  return value;
}

export function formatTimestamp(value: number): string {
  return new Date(validateInstant(value)).toISOString();
}

export function readClock(now: () => number): number {
  return validateInstant(now());
}
