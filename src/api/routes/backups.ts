import type { FastifyInstance } from 'fastify';
import * as z from 'zod/mini';
import { domainError } from '../../core/errors.js';
import { mutationEnvelopeSchema } from '../../schema/envelopes.js';
import { backupListInputSchema } from '../../schema/recovery.js';
import { slugSchema, uuidSchema } from '../../schema/values.js';
import type { DataHelper } from '../helper-client.js';
import type { RecoveryServices } from '../recovery-port.js';
import { emptyQuery, queryInput } from './transport.js';

const projectParams = z.strictObject({ project_slug: slugSchema });
const backupParams = z.strictObject({ backup_id: uuidSchema });
const validateBody = z.strictObject({ all_projects: z.literal(true) });

export function registerBackupRoutes(
  app: FastifyInstance,
  helper: DataHelper,
  recovery?: RecoveryServices,
): void {
  app.get('/api/v1/backups', async (request) =>
    helper.request({
      operation: 'backup.list',
      input: backupListInputSchema.parse(
        queryInput(request.query, ['all_projects', 'limit', 'cursor']),
      ),
    }),
  );
  app.post('/api/v1/projects/:project_slug/backups', async (request, reply) => {
    emptyQuery(request.query);
    const { project_slug } = projectParams.parse(request.params);
    const input = mutationEnvelopeSchema.parse(request.body);
    const result = await helper.request({
      operation: 'backup.create',
      scope: { project_slug },
      input,
    });
    return reply.code(201).send(result);
  });
  app.post('/api/v1/backups/:backup_id/validate', async (request) => {
    emptyQuery(request.query);
    const { backup_id } = backupParams.parse(request.params);
    const scope = validateBody.parse(request.body);
    return helper.request({ operation: 'backup.validate', backup_id, scope });
  });
  app.post('/api/v1/projects/:project_slug/backups/restore', async (request, reply) => {
    emptyQuery(request.query);
    const { project_slug } = projectParams.parse(request.params);
    if (!recovery) throw domainError('MAINTENANCE', 'Recovery service is unavailable');
    const envelope = mutationEnvelopeSchema.parse(request.body);
    const result = await recovery.restore({ projectSlug: project_slug, envelope, caller: 'web' });
    return reply.code(202).send(result);
  });
}
