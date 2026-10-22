import type { FastifyInstance } from 'fastify';
import { domainError } from '../core/errors.js';

/** Decode bytes without replacement, then retain Fastify's secure JSON/prototype policy. */
export function registerStrictJsonParser(app: FastifyInstance): void {
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser<Buffer>(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      let source: string;
      try {
        source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
      } catch {
        done(domainError('VALIDATION_ERROR', 'JSON must contain valid UTF-8'));
        return;
      }
      parseJson(request, source, done);
    },
  );
}
