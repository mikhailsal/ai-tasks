import type { FastifyInstance } from 'fastify';
import type { DataHelper } from '../helper-client.js';
import {
  emptyQuery,
  projectQueryKeys,
  queryInput,
  registerMutationRoute,
  routeParams,
} from './transport.js';

export function registerProjectRoutes(app: FastifyInstance, helper: DataHelper): void {
  app.get('/api/v1/projects', async (request) =>
    helper.request({
      operation: 'project.list',
      input: queryInput(request.query, projectQueryKeys),
    }),
  );
  app.get('/api/v1/projects/:project_slug', async (request) => {
    emptyQuery(request.query);
    return helper.request({ operation: 'project.get', scope: routeParams(request.params) });
  });
  const base = '/api/v1/projects/:project_slug';
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: base,
    operation: 'project.create',
    created: true,
  });
  registerMutationRoute(app, helper, { method: 'PATCH', url: base, operation: 'project.update' });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: `${base}/archive`,
    operation: 'project.archive',
  });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: `${base}/restore`,
    operation: 'project.restore',
  });
}
