import * as z from 'zod/mini';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { domainError } from '../../core/errors.js';
import { readScopeSchema } from '../../schema/scopes.js';
import { jsonValueSchema, slugSchema, uuidSchema, type JsonValue } from '../../schema/values.js';
import { helperCommandSchema } from '../helper-protocol.js';
import type { DataHelper } from '../helper-client.js';
const projectParamsSchema = z.strictObject({ project_slug: slugSchema });
const taskParamsSchema = z.extend(projectParamsSchema, { task_id: uuidSchema });
export const projectQueryKeys = ['project_slug', 'all_projects', 'archive', 'limit', 'cursor'];
export const taskQueryKeys = [
  ...projectQueryKeys,
  'include_terminal',
  'q',
  'kind',
  'status_id',
  'category',
  'emoji',
  'priority',
  'deadline_preset',
  'deadline_day',
];
export function routeParams(value: unknown, task = false) {
  return task ? taskParamsSchema.parse(value) : projectParamsSchema.parse(value);
}
export function emptyQuery(value: unknown): void {
  assertQueryKeys(value, []);
  z.strictObject({}).parse(value);
}
function assertQueryKeys(value: unknown, allowed: readonly string[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw domainError('VALIDATION_ERROR', 'Query must contain named fields');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key))
      throw domainError('VALIDATION_ERROR', 'Unknown query field');
  }
}
function queryValue(key: string, value: string): JsonValue {
  if (key === 'limit') {
    if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value)))
      throw domainError('VALIDATION_ERROR', 'Limit must be a positive integer');
    return Number(value);
  }
  if (key === 'all_projects' || key === 'include_terminal') {
    if (value !== 'true' && value !== 'false')
      throw domainError('VALIDATION_ERROR', 'Boolean query values must be true or false');
    return value === 'true';
  }
  if (key === 'priority') {
    try {
      return jsonValueSchema.parse(JSON.parse(value));
    } catch {
      throw domainError('VALIDATION_ERROR', 'Priority query must contain JSON');
    }
  }
  return value;
}
/** Duplicate values become arrays in Fastify and are rejected rather than silently selected. */
export function queryInput(value: unknown, allowed: readonly string[]): Record<string, JsonValue> {
  assertQueryKeys(value, allowed);
  const query = z.record(z.string(), z.string()).parse(value);
  return Object.fromEntries(
    Object.entries(query).map(([key, text]) => {
      if (!allowed.includes(key)) throw domainError('VALIDATION_ERROR', 'Unknown query field');
      return [key, queryValue(key, text)];
    }),
  );
}
export function queryScope(value: unknown) {
  return readScopeSchema.parse(queryInput(value, ['project_slug', 'all_projects']));
}
export function registerMutationRoute(
  app: FastifyInstance,
  helper: DataHelper,
  options: {
    method: HTTPMethods;
    url: string;
    operation: string;
    task?: boolean;
    created?: boolean;
  },
): void {
  app.route({
    method: options.method,
    url: options.url,
    handler: async (request, reply) => {
      emptyQuery(request.query);
      const params = routeParams(request.params, options.task);
      const command = helperCommandSchema.parse({
        operation: options.operation,
        scope: { project_slug: params.project_slug },
        ...('task_id' in params ? { task_id: params.task_id } : {}),
        input: request.body,
      });
      const result = await helper.request(command);
      return reply.code(options.created ? 201 : 200).send(result);
    },
  });
}
