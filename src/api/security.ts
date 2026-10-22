import type { FastifyInstance, FastifyRequest } from 'fastify';
import { domainError } from '../core/errors.js';

export type SecurityOptions = { host: string; origin: string; developmentOrigin?: string };

function exactOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin)
    throw new Error('Invalid configured browser origin');
  return origin;
}

function checkRequest(request: FastifyRequest, options: SecurityOptions): void {
  const reject = () => domainError('ORIGIN_REJECTED', 'Request origin is not allowed');
  if (request.headers.host !== options.host) throw reject();
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined && !['same-origin', 'same-site', 'none'].includes(String(site)))
    throw reject();
  if (!['POST', 'PATCH', 'PUT'].includes(request.method)) return;
  const origin = request.headers.origin;
  if (
    origin !== options.origin &&
    (options.developmentOrigin === undefined || origin !== options.developmentOrigin)
  )
    throw reject();
  const contentType = request.headers['content-type'];
  if (
    typeof contentType !== 'string' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)
  )
    throw reject();
  if (request.headers['x-ai-tasks-mutation'] !== '1') throw reject();
}

export function registerSecurity(app: FastifyInstance, options: SecurityOptions): void {
  exactOrigin(options.origin);
  if (options.developmentOrigin !== undefined) exactOrigin(options.developmentOrigin);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    checkRequest(request, options);
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    // Static delivery may set its own cache policy after onRequest.
    reply.header('Cache-Control', 'no-store');
    return payload;
  });
}
