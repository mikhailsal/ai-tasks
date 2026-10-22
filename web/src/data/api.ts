import type { z } from 'zod/mini';
import {
  errorEnvelopeSchema,
  mutationEnvelopeSchema,
  mutationSuccessEnvelopeSchema,
  type ErrorEnvelope,
  type MutationEnvelope,
  type MutationSuccessEnvelope,
} from '../../../src/schema/envelopes.js';
import {
  recoveryJobEnvelopeSchema,
  recoveryStatusInputSchema,
  type RecoveryJobEnvelope,
} from '../../../src/schema/recovery.js';
import { jsonBodySchema, type JsonValue } from '../../../src/schema/values.js';
import { readSnapshot, recordRead } from './cache.js';
import {
  canMutate,
  connectivitySnapshot,
  markMaintenance,
  updateConnectivity,
} from './connectivity.js';
export class ApiClientError extends Error {
  readonly code: string;
  readonly details: ErrorEnvelope['error']['details'];
  readonly retryable: boolean;
  readonly definitelyUnsent: boolean;
  constructor(error: ErrorEnvelope['error'], definitelyUnsent = false) {
    super(error.message);
    this.name = 'ApiClientError';
    this.code = error.code;
    this.details = error.details;
    this.retryable = error.retryable;
    this.definitelyUnsent = definitelyUnsent;
  }
}
function clientError(code: string, message: string, definitelyUnsent = false): ApiClientError {
  return new ApiClientError({ code, message, details: null, retryable: false }, definitelyUnsent);
}
function apiUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('#')) {
    throw clientError('VALIDATION_ERROR', 'Некорректный адрес запроса.');
  }
  const url = new URL(`/api/v1${path}`, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/v1/')) {
    throw clientError('VALIDATION_ERROR', 'Некорректный адрес запроса.');
  }
  return url.href;
}
async function fetchJson(path: string, options: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw clientError(
      'CONNECTION_ERROR',
      'Не удалось связаться с приложением. Проверьте соединение.',
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw clientError('INVALID_RESPONSE', 'Не удалось прочитать ответ приложения.');
  }
  const failure = errorEnvelopeSchema.safeParse(value);
  if (failure.success) {
    if (failure.data.error.code === 'MAINTENANCE') markMaintenance(true);
    if (failure.data.error.code === 'DATABASE_EPOCH_CONFLICT')
      updateConnectivity({ reconciling: true });
    throw new ApiClientError(failure.data.error);
  }
  if (!response.ok) throw clientError('INVALID_RESPONSE', 'Приложение не смогло выполнить запрос.');
  return value;
}
async function requiredSnapshot(path: string) {
  const value = await readSnapshot(path);
  if (value === undefined)
    throw clientError(
      'CACHE_MISS',
      'Эта страница не сохранена для работы без сети. Откройте её при подключении.',
    );
  return value;
}
async function readValue(path: string, signal?: AbortSignal) {
  if (!navigator.onLine) return { value: await requiredSnapshot(path), cached: true };
  try {
    return {
      value: await fetchJson(path, { method: 'GET', ...(signal ? { signal } : {}) }),
      cached: false,
    };
  } catch (failure) {
    if (
      !(failure instanceof ApiClientError) ||
      !['CONNECTION_ERROR', 'MAINTENANCE'].includes(failure.code) ||
      signal?.aborted
    )
      throw failure;
    if (failure.code === 'CONNECTION_ERROR')
      updateConnectivity({ online: false, reconciling: false });
    return { value: await requiredSnapshot(path), cached: true };
  }
}
/** Paths are relative to /api/v1; the supplied schema also validates restored snapshots. */
export async function getApi<Schema extends z.ZodMiniType>(
  path: string,
  responseSchema: Schema,
  signal?: AbortSignal,
): Promise<z.output<Schema>> {
  apiUrl(path);
  const requestEpoch = connectivitySnapshot().epoch;
  const { value, cached } = await readValue(path, signal);
  const result = responseSchema.safeParse(value);
  if (!result.success)
    throw clientError('INVALID_RESPONSE', 'Ответ приложения имеет неверный формат.');
  if (!cached && !(await recordRead(path, result.data, requestEpoch)))
    throw clientError(
      'DATABASE_EPOCH_CONFLICT',
      'База данных обновилась во время чтения. Загрузите текущую версию.',
    );
  return result.data;
}
/** Pure POST reads share the browser boundary, without allocating mutation IDs. */
export async function queryApi<Schema extends z.ZodMiniType>(options: {
  path: string;
  input: JsonValue;
  responseSchema: Schema;
  signal?: AbortSignal;
}): Promise<z.output<Schema>> {
  assertMutationReady(connectivitySnapshot().epoch ?? '');
  const parsed = jsonBodySchema.safeParse(options.input);
  if (!parsed.success) throw clientError('VALIDATION_ERROR', 'Проверьте данные запроса.');
  const value = await fetchJson(options.path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AI-Tasks-Mutation': '1' },
    body: JSON.stringify(parsed.data),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const result = options.responseSchema.safeParse(value);
  if (!result.success)
    throw clientError('INVALID_RESPONSE', 'Ответ приложения имеет неверный формат.');
  return result.data;
}
export async function mutateApi(options: {
  path: string;
  method: 'POST' | 'PATCH' | 'PUT';
  envelope: MutationEnvelope;
  currentEpoch: string;
  signal?: AbortSignal;
}): Promise<MutationSuccessEnvelope> {
  assertMutationReady(options.envelope.database_epoch);
  const parsed = mutationEnvelopeSchema.safeParse(options.envelope);
  if (!parsed.success)
    throw clientError('VALIDATION_ERROR', 'Проверьте данные перед сохранением.', true);
  if (parsed.data.database_epoch !== options.currentEpoch) {
    throw clientError(
      'DATABASE_EPOCH_CONFLICT',
      'Данные приложения обновились. Загрузите их заново.',
      true,
    );
  }
  if (!jsonBodySchema.safeParse(parsed.data).success) {
    throw clientError('VALIDATION_ERROR', 'Запрос слишком большой для сохранения.', true);
  }
  assertMutationReady(parsed.data.database_epoch, options.path);
  const value = await fetchJson(options.path, {
    method: options.method,
    headers: { 'Content-Type': 'application/json', 'X-AI-Tasks-Mutation': '1' },
    body: JSON.stringify(parsed.data),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const result = mutationSuccessEnvelopeSchema.safeParse(value);
  if (!result.success)
    throw clientError('INVALID_RESPONSE', 'Ответ приложения имеет неверный формат.');
  return result.data;
}

/** Local rejection means this attempt never reached fetch; a prior uncertain attempt remains distinct. */
export function assertMutationReady(epoch: string, path?: string): void {
  const state = connectivitySnapshot();
  if (!navigator.onLine || !state.online)
    throw clientError('OFFLINE', 'Для сохранения изменений необходимо подключение.', true);
  if (state.epoch !== epoch)
    throw clientError(
      'DATABASE_EPOCH_CONFLICT',
      'База данных обновилась. Проверьте текущую версию перед сохранением.',
      true,
    );
  const project = path?.match(/^\/projects\/([^/]+)(?:\/|$)/u)?.[1];
  if (project !== undefined && state.unavailableProjects.includes(decodeURIComponent(project)))
    throw clientError(
      'PROJECT_NOT_FOUND',
      'Этот проект отсутствует в восстановленной базе данных. Черновик сохранён отдельно.',
      true,
    );
  if (!canMutate(epoch))
    throw clientError(
      'MAINTENANCE',
      state.maintenance
        ? 'Приложение на обслуживании. Сохранение станет доступно после обновления данных.'
        : 'Обновляем данные перед сохранением. Дождитесь завершения проверки.',
      true,
    );
}

/** Historical operational receipts remain readable through maintenance and later database epochs. */
export async function getRecoveryJobApi(options: {
  jobId?: string;
  operationId?: string;
  signal?: AbortSignal;
}): Promise<RecoveryJobEnvelope> {
  const query = recoveryStatusInputSchema.safeParse({
    all_projects: true,
    ...(options.jobId === undefined ? {} : { job_id: options.jobId }),
    ...(options.operationId === undefined ? {} : { operation_id: options.operationId }),
  });
  if (!query.success)
    throw clientError('VALIDATION_ERROR', 'Укажите одну операцию восстановления.', true);
  if (!navigator.onLine)
    throw clientError('OFFLINE', 'Для проверки восстановления необходимо подключение.', true);
  const path =
    query.data.job_id === undefined
      ? `/backups/jobs?all_projects=true&operation_id=${encodeURIComponent(query.data.operation_id ?? '')}`
      : `/backups/jobs/${query.data.job_id}?all_projects=true`;
  const value = await fetchJson(path, {
    method: 'GET',
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const parsed = recoveryJobEnvelopeSchema.safeParse(value);
  if (!parsed.success)
    throw clientError('INVALID_RESPONSE', 'Не удалось проверить состояние восстановления.');
  return parsed.data;
}
