import type { FastifyInstance } from 'fastify';
import * as z from 'zod/mini';
import { domainError } from '../../core/errors.js';
import { recoveryStatusInputSchema } from '../../schema/recovery.js';
import { uuidSchema } from '../../schema/values.js';
import type { RecoveryServices } from '../recovery-port.js';
import { queryInput } from './transport.js';

const jobParams = z.strictObject({ job_id: uuidSchema });
const jobQuery = z.strictObject({ all_projects: z.literal(true) });

export function registerRecoveryStatusRoutes(
  app: FastifyInstance,
  recovery?: RecoveryServices,
): void {
  app.get('/api/v1/backups/jobs/:job_id', async (request) => {
    const { job_id } = jobParams.parse(request.params);
    jobQuery.parse(queryInput(request.query, ['all_projects']));
    if (!recovery) throw domainError('MAINTENANCE', 'Recovery status is unavailable');
    return recovery.status({ jobId: job_id });
  });
  app.get('/api/v1/backups/jobs', async (request) => {
    const input = recoveryStatusInputSchema.parse(
      queryInput(request.query, ['all_projects', 'operation_id']),
    );
    if (!recovery) throw domainError('MAINTENANCE', 'Recovery status is unavailable');
    return recovery.status({
      ...(input.operation_id === undefined ? {} : { operationId: input.operation_id }),
    });
  });
}
