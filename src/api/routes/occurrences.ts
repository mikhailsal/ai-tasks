import type { FastifyInstance } from 'fastify';
import { z } from 'zod/mini';
import { slugSchema, uuidSchema } from '../../schema/values.js';
import type { DataHelper } from '../helper-client.js';
import { emptyQuery, queryInput, registerMutationRoute, routeParams } from './transport.js';
const occurrenceParams = z.strictObject({
  project_slug: slugSchema,
  task_id: uuidSchema,
  occurrence_id: uuidSchema,
});
export function registerOccurrenceRoutes(app: FastifyInstance, helper: DataHelper): void {
  const base = '/api/v1/projects/:project_slug/tasks/:task_id/occurrences';
  app.get(base, async (request) => {
    const params = routeParams(request.params, true);
    return helper.request({
      operation: 'occurrence.list',
      scope: { project_slug: params.project_slug },
      task_id: uuidSchema.parse('task_id' in params ? params.task_id : undefined),
      input: queryInput(request.query, ['state', 'limit', 'cursor']),
    });
  });
  app.get(`${base}/:occurrence_id`, async (request) => {
    emptyQuery(request.query);
    const params = occurrenceParams.parse(request.params);
    return helper.request({
      operation: 'occurrence.get',
      scope: { project_slug: params.project_slug },
      task_id: params.task_id,
      occurrence_id: params.occurrence_id,
    });
  });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: `${base}/complete`,
    operation: 'occurrence.complete',
    task: true,
  });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: `${base}/cancel`,
    operation: 'occurrence.cancel',
    task: true,
  });
}
