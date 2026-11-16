import { domainError, normalizeError, type DomainError } from '../errors.js';
import { hint } from './hints.js';

/** Missing read scope keeps today's `issues` and adds the two accepted choices (spec 004 FR-004). */
export function scopeRefusal(
  error: unknown,
  message: string,
  choices: readonly string[],
): DomainError {
  const normalized = normalizeError(error);
  const base =
    typeof normalized.details === 'object' &&
    normalized.details !== null &&
    !Array.isArray(normalized.details)
      ? normalized.details
      : {};
  return domainError('VALIDATION_ERROR', message, {
    ...base,
    hints: [hint('choose_scope', `Use ${choices.join(' or ')}`)],
  });
}
