import type { FastifyInstance } from 'fastify';
import { uuidSchema } from '../../schema/values.js';
import type { DataHelper } from '../helper-client.js';
import {
  emptyQuery,
  queryInput,
  registerMutationRoute,
  routeParams,
  taskQueryKeys,
} from './transport.js';

export function registerTaskRoutes(app: FastifyInstance, helper: DataHelper): void {
  app.get('/api/v1/tasks', async (request) =>
    helper.request({ operation: 'task.list', input: queryInput(request.query, taskQueryKeys) }),
  );
  app.get('/api/v1/projects/:project_slug/board', async (request) => {
    const params = routeParams(request.params);
    return helper.request({
      operation: 'task.board',
      input: {
        ...queryInput(
          request.query,
          taskQueryKeys.filter((key) => key !== 'project_slug' && key !== 'all_projects'),
        ),
        project_slug: params.project_slug,
      },
    });
  });
  const base = '/api/v1/projects/:project_slug/tasks';
  app.get(`${base}/:task_id`, async (request) => {
    emptyQuery(request.query);
    const params = routeParams(request.params, true);
    return helper.request({
      operation: 'task.get',
      scope: { project_slug: params.project_slug },
      task_id: uuidSchema.parse('task_id' in params ? params.task_id : undefined),
    });
  });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: base,
    operation: 'task.create',
    created: true,
  });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: `${base}/:task_id/position`,
    operation: 'task.position',
    task: true,
  });
  registerMutationRoute(app, helper, {
    method: 'PATCH',
    url: `${base}/:task_id`,
    operation: 'task.update',
    task: true,
  });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: `${base}/:task_id/transitions`,
    operation: 'task.transition',
    task: true,
  });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: `${base}/:task_id/archive`,
    operation: 'task.archive',
    task: true,
  });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: `${base}/:task_id/restore`,
    operation: 'task.restore',
    task: true,
  });
}
