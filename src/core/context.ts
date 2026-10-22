import { z } from 'zod/mini';
import { slugSchema } from '../schema/values.js';
import type { openDatabase } from './database/open.js';
import { domainError } from './errors.js';
import { readClock } from './clock.js';
export const actorSchema = z.union([
  z.literal('human-web'),
  z
    .templateLiteral(['ai-cli:', z.string()])
    .check(z.refine((actor) => slugSchema.safeParse(actor.slice(7)).success)),
]);
export function createContext(options: {
  connection: ReturnType<typeof openDatabase>;
  actor: z.infer<typeof actorSchema>;
  now?: () => number;
  origin?: 'recurrence-worker';
}) {
  const identity = actorSchema.safeParse(options.actor);
  if (
    !identity.success ||
    (options.origin === 'recurrence-worker' && options.actor === 'human-web')
  ) {
    throw domainError(
      'VALIDATION_ERROR',
      'Actor and origin must identify a supported application caller',
    );
  }
  const actor = identity.data;
  const origin = options.origin ?? (actor === 'human-web' ? 'web' : 'cli');
  const clock = options.now ?? options.connection.now;
  return { connection: options.connection, actor, origin, now: () => readClock(clock) };
}
/** Reads need a connection and clock, without inventing a mutation actor or scope. */
export function createReadContext(options: {
  connection: ReturnType<typeof openDatabase>;
  now?: () => number;
}) {
  const clock = options.now ?? options.connection.now;
  return { connection: options.connection, now: () => readClock(clock) };
}
