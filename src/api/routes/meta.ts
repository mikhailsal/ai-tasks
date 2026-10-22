import type { FastifyInstance } from 'fastify';
import { domainError } from '../../core/errors.js';
import { metaEnvelopeSchema } from '../../schema/meta.js';
import type { DataHelper } from '../helper-client.js';
import { queryScope } from './transport.js';

export function registerMetaRoutes(app: FastifyInstance, helper: DataHelper): void {
  app.get('/api/v1/meta', async (request) => {
    const query = queryScope(request.query);
    if (!('all_projects' in query))
      throw domainError('VALIDATION_ERROR', 'Metadata requires all_projects=true');
    return metaEnvelopeSchema.parse(await helper.request({ operation: 'meta', scope: query }));
  });
}
