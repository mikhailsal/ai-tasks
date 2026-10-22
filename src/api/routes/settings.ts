import type { FastifyInstance } from 'fastify';
import type { DataHelper } from '../helper-client.js';
import { queryScope, registerMutationRoute } from './transport.js';

export function registerSettingsRoutes(app: FastifyInstance, helper: DataHelper): void {
  app.get('/api/v1/settings', async (request) =>
    helper.request({ operation: 'settings.get', scope: queryScope(request.query) }),
  );
  registerMutationRoute(app, helper, {
    method: 'PATCH',
    url: '/api/v1/projects/:project_slug/application-settings',
    operation: 'settings.update',
  });
}
