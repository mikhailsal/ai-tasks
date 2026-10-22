import type { FastifyInstance } from 'fastify';
import type { DataHelper } from '../helper-client.js';
import { queryInput } from './transport.js';

const auditQueryKeys = [
  'project_slug',
  'all_projects',
  'entity_id',
  'operation_id',
  'limit',
  'cursor',
];

/** Historical scope is independent of the current live project inventory. */
export function registerAuditRoutes(app: FastifyInstance, helper: DataHelper): void {
  app.get('/api/v1/audit', async (request) =>
    helper.request({
      operation: 'audit.list',
      input: queryInput(request.query, auditQueryKeys),
    }),
  );
}
