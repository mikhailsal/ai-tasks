import type { FastifyInstance } from 'fastify';
import { helperCommandSchema } from '../helper-protocol.js';
import type { DataHelper } from '../helper-client.js';
import { emptyQuery, queryScope, registerMutationRoute, routeParams } from './transport.js';

export function registerConfigurationRoutes(app: FastifyInstance, helper: DataHelper): void {
  app.get('/api/v1/config/presets', async (request) =>
    helper.request({ operation: 'config.presets', scope: queryScope(request.query) }),
  );
  app.get('/api/v1/projects/:project_slug/config', async (request) => {
    emptyQuery(request.query);
    return helper.request({ operation: 'config.get', scope: routeParams(request.params) });
  });
  app.post('/api/v1/projects/:project_slug/config/preview', async (request) => {
    emptyQuery(request.query);
    const scope = routeParams(request.params);
    return helper.request(
      helperCommandSchema.parse({
        operation: 'config.preview',
        scope,
        input: request.body,
      }),
    );
  });
  registerMutationRoute(app, helper, {
    method: 'POST',
    url: '/api/v1/projects/:project_slug/config/migrate',
    operation: 'config.migrate',
  });
}
