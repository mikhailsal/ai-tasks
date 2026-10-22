import type { FastifyInstance } from 'fastify';
import { helperCommandSchema } from '../helper-protocol.js';
import type { DataHelper } from '../helper-client.js';
import { emptyQuery, routeParams } from './transport.js';

export function registerDescriptionRoutes(app: FastifyInstance, helper: DataHelper): void {
  app.post('/api/v1/projects/:project_slug/description/preview', async (request) => {
    emptyQuery(request.query);
    const scope = routeParams(request.params);
    return helper.request(
      helperCommandSchema.parse({ operation: 'description.preview', scope, input: request.body }),
    );
  });
}
