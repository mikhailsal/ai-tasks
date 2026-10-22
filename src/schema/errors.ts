import * as z from 'zod/mini';
export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'TASK_NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'PROJECT_MISMATCH',
  'DB_CONFLICT',
  'REVISION_CONFLICT',
  'CONFIG_CONFLICT',
  'CURSOR_STALE',
  'DEPENDENCY_BLOCKED',
  'EMOJI_CONFLICT',
  'CONFIRMATION_REQUIRED',
  'IDEMPOTENCY_CONFLICT',
  'DATABASE_EPOCH_CONFLICT',
  'MAINTENANCE',
  'ORIGIN_REJECTED',
  'ROUTE_NOT_FOUND',
  'INTERNAL_ERROR',
]);
export const zodErrorCodeSchema = errorCodeSchema;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const errorDefinitions = {
  VALIDATION_ERROR: { httpStatus: 400, cliExit: 2, retryable: false, message: 'Invalid request' },
  TASK_NOT_FOUND: { httpStatus: 404, cliExit: 3, retryable: false, message: 'Task not found' },
  PROJECT_NOT_FOUND: {
    httpStatus: 404,
    cliExit: 3,
    retryable: false,
    message: 'Project not found',
  },
  PROJECT_MISMATCH: {
    httpStatus: 409,
    cliExit: 4,
    retryable: false,
    message: 'Target belongs to another project',
  },
  DB_CONFLICT: {
    httpStatus: 409,
    cliExit: 4,
    retryable: true,
    message: 'Database lock wait exhausted',
  },
  REVISION_CONFLICT: {
    httpStatus: 409,
    cliExit: 4,
    retryable: false,
    message: 'Entity changed since it was read',
  },
  CONFIG_CONFLICT: {
    httpStatus: 409,
    cliExit: 4,
    retryable: false,
    message: 'Configuration changed since it was read',
  },
  CURSOR_STALE: {
    httpStatus: 409,
    cliExit: 4,
    retryable: false,
    message: 'Pagination context changed; restart pagination',
  },
  DEPENDENCY_BLOCKED: {
    httpStatus: 409,
    cliExit: 4,
    retryable: false,
    message: 'Dependency requirements are not satisfied',
  },
  EMOJI_CONFLICT: {
    httpStatus: 409,
    cliExit: 4,
    retryable: false,
    message: 'Emoji is already reserved',
  },
  CONFIRMATION_REQUIRED: {
    httpStatus: 409,
    cliExit: 4,
    retryable: false,
    message: 'Explicit user confirmation is required',
  },
  IDEMPOTENCY_CONFLICT: {
    httpStatus: 409,
    cliExit: 4,
    retryable: false,
    message: 'Operation ID was already used with different content',
  },
  DATABASE_EPOCH_CONFLICT: {
    httpStatus: 409,
    cliExit: 4,
    retryable: false,
    message: 'Database epoch changed; refresh current state',
  },
  MAINTENANCE: {
    httpStatus: 503,
    cliExit: 5,
    retryable: true,
    message: 'Database maintenance is in progress',
  },
  // HTTP-only policy failures cannot normally reach CLI; an internal failure exit is
  // the fallback rather than inventing another public CLI exit code.
  ORIGIN_REJECTED: {
    httpStatus: 403,
    cliExit: 1,
    retryable: false,
    message: 'Request origin is not allowed',
  },
  ROUTE_NOT_FOUND: {
    httpStatus: 404,
    cliExit: 1,
    retryable: false,
    message: 'Resource route not found',
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    cliExit: 1,
    retryable: false,
    message: 'An internal error occurred',
  },
} as const satisfies Record<
  ErrorCode,
  {
    httpStatus: number;
    cliExit: number;
    retryable: boolean;
    message: string;
  }
>;
