import type { FastifyInstance } from 'fastify';
import type { DataHelper } from '../helper-client.js';
import { queryInput, taskQueryKeys } from './transport.js';

const statisticsQueryKeys = [
  ...taskQueryKeys.filter((key) => key !== 'limit' && key !== 'cursor'),
  'from',
  'to',
];

export function registerViewRoutes(app: FastifyInstance, helper: DataHelper): void {
  app.get('/api/v1/agenda', async (request) =>
    helper.request({ operation: 'agenda.list', input: queryInput(request.query, taskQueryKeys) }),
  );
  app.get('/api/v1/priorities', async (request) =>
    helper.request({
      operation: 'priorities.list',
      input: queryInput(request.query, taskQueryKeys),
    }),
  );
  app.get('/api/v1/stats', async (request) =>
    helper.request({
      operation: 'stats.get',
      input: queryInput(request.query, statisticsQueryKeys),
    }),
  );
}
