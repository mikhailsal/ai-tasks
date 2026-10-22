import fastify from 'fastify';
import { domainError, errorEnvelope, httpStatus } from '../core/errors.js';
import { registerSecurity } from './security.js';
import type { DataHelper } from './helper-client.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerConfigurationRoutes } from './routes/configuration.js';
import { registerDescriptionRoutes } from './routes/descriptions.js';
import { registerStrictJsonParser } from './json-parser.js';
import { registerDependencyRoutes } from './routes/dependencies.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerStatic } from './static.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerRecurrenceRoutes } from './routes/recurrence.js';
import { registerOccurrenceRoutes } from './routes/occurrences.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerViewRoutes } from './routes/views.js';
import type { RecoveryServices } from './recovery-port.js';
import { registerBackupRoutes } from './routes/backups.js';
import { registerRecoveryStatusRoutes } from './routes/recovery-status.js';

/** HTTP owns no SQLite connection or shared lifetime lock. */
export function createApp(options: {
  helper: DataHelper;
  recovery?: RecoveryServices;
  host?: string;
  origin?: string;
  developmentOrigin?: string;
}) {
  const app = fastify({ logger: false, bodyLimit: 1_048_576, trustProxy: false });
  registerStrictJsonParser(app);
  const host = options.host ?? '127.0.0.1:3000';
  registerSecurity(app, {
    host,
    origin: options.origin ?? `http://${host}`,
    ...(options.developmentOrigin === undefined
      ? {}
      : { developmentOrigin: options.developmentOrigin }),
  });
  app.setErrorHandler((error, _request, reply) => {
    const safe = errorEnvelope(error);
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      const envelope = errorEnvelope(
        domainError('VALIDATION_ERROR', 'JSON request body exceeds 1 MiB'),
      );
      return reply.code(400).send(envelope);
    }
    if (code === 'FST_ERR_CTP_INVALID_JSON_BODY' || code === 'FST_ERR_CTP_EMPTY_JSON_BODY')
      return reply
        .code(400)
        .send(errorEnvelope(domainError('VALIDATION_ERROR', 'Invalid JSON request body')));
    return reply.code(httpStatus(safe.error.code)).send(safe);
  });
  registerMetaRoutes(app, options.helper);
  registerProjectRoutes(app, options.helper);
  registerTaskRoutes(app, options.helper);
  registerConfigurationRoutes(app, options.helper);
  registerDescriptionRoutes(app, options.helper);
  registerDependencyRoutes(app, options.helper);
  registerAuditRoutes(app, options.helper);
  registerRecurrenceRoutes(app, options.helper);
  registerOccurrenceRoutes(app, options.helper);
  registerSettingsRoutes(app, options.helper);
  registerViewRoutes(app, options.helper);
  registerBackupRoutes(app, options.helper, options.recovery);
  registerRecoveryStatusRoutes(app, options.recovery);
  registerStatic(app);
  app.addHook('onClose', async () => options.helper.close());
  return app;
}
