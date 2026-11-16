import { $ZodError } from 'zod/v4/core';
import { errorCodeSchema, errorDefinitions, type ErrorCode } from '../schema/errors.js';
import type { ErrorEnvelope } from '../schema/envelopes.js';
import { jsonValueSchema, type JsonValue } from '../schema/values.js';
import { validationDetails } from './diagnostics/issues.js';
/** Messages and details supplied here are authored public diagnostics, never raw
 * persistence errors or unvalidated transport payloads. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: JsonValue;
  readonly retryable: boolean;
  constructor(code: ErrorCode, message: string, details: JsonValue = null) {
    super(message);
    this.name = 'DomainError';
    this.code = errorCodeSchema.parse(code);
    this.details = jsonValueSchema.parse(details);
    this.retryable = errorDefinitions[this.code].retryable;
  }
}
export function domainError(
  code: ErrorCode,
  message: string,
  details: JsonValue = null,
): DomainError {
  return new DomainError(code, message, details);
}
function defaultError(code: ErrorCode): DomainError {
  return domainError(code, errorDefinitions[code].message);
}
function operationalError(error: unknown): DomainError | undefined {
  if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'string') return;
  if (/^SQLITE_(?:BUSY|LOCKED)(?:_[A-Z0-9]+)*$/u.test(error.code))
    return defaultError('DB_CONFLICT');
  // Runtime/open/recovery errors carry stable operational codes, but their raw
  // messages may contain paths or SQLite diagnostics. Keep only the validated code.
  const parsed = errorCodeSchema.safeParse(error.code);
  if (!parsed.success) return;
  if (['DB_CONFLICT', 'VALIDATION_ERROR', 'MAINTENANCE', 'INTERNAL_ERROR'].includes(parsed.data)) {
    return defaultError(parsed.data);
  }
  return;
}
export function normalizeError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  if (error instanceof $ZodError) {
    const { message, details } = validationDetails(error.issues);
    return domainError('VALIDATION_ERROR', message, details);
  }
  return operationalError(error) ?? defaultError('INTERNAL_ERROR');
}
export function errorEnvelope(error: unknown): ErrorEnvelope {
  const normalized = normalizeError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
      retryable: normalized.retryable,
    },
  };
}
function codeFor(error: unknown): ErrorCode {
  const code = errorCodeSchema.safeParse(error);
  return code.success ? code.data : normalizeError(error).code;
}
export function httpStatus(error: unknown): number {
  return errorDefinitions[codeFor(error)].httpStatus;
}
export function cliExit(error: unknown): number {
  return errorDefinitions[codeFor(error)].cliExit;
}
