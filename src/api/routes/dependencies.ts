import type { FastifyInstance } from 'fastify';
import { uuidSchema } from '../../schema/values.js';
import type { DataHelper } from '../helper-client.js';
import { emptyQuery, registerMutationRoute, routeParams } from './transport.js';

export function registerDependencyRoutes(app: FastifyInstance, helper: DataHelper): void {
  const base = '/api/v1/projects/:project_slug/tasks/:task_id/dependencies';
  app.get(base, async (request) => {
    emptyQuery(request.query);
    const params = routeParams(request.params, true);
    return helper.request({
      operation: 'dependency.list',
      scope: { project_slug: params.project_slug },
      task_id: uuidSchema.parse('task_id' in params ? params.task_id : undefined),
    });
  });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: base,
    operation: 'dependency.add',
    task: true,
    created: true,
  });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: `${base}/remove`,
    operation: 'dependency.remove',
    task: true,
  });
}
