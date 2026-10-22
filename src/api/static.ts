import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { domainError, errorEnvelope } from '../core/errors.js';

function staticDirectory(): string {
  const entries = [
    new URL('../../web/dist/', import.meta.url),
    new URL('../web/dist/', import.meta.url),
  ];
  const directory = entries.find((url) => existsSync(new URL('index.html', url)));
  return fileURLToPath(directory ?? entries[0] ?? new URL('../../web/dist/', import.meta.url));
}

/** Shell delivery stays available while data helpers are closed for maintenance. */
export function registerStatic(app: FastifyInstance): void {
  const root = staticDirectory();
  if (existsSync(root))
    app.register(fastifyStatic, { root, wildcard: false, index: ['index.html'] });
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] ?? '';
    if (pathname.startsWith('/api'))
      return reply
        .code(404)
        .send(errorEnvelope(domainError('ROUTE_NOT_FOUND', 'API route not found')));
    if (request.method === 'GET' && existsSync(join(root, 'index.html')) && !pathname.includes('.'))
      return reply.sendFile('index.html');
    return reply
      .code(404)
      .send(errorEnvelope(domainError('ROUTE_NOT_FOUND', 'Resource not found')));
  });
}
