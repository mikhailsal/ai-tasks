import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod/mini';
import type { applicationState } from '../../schema/entities.js';
import { revisionSchema, uuidSchema } from '../../schema/values.js';
import { domainError } from '../errors.js';
import { formatTimestamp } from '../time.js';
type CursorState = Pick<typeof applicationState.$inferSelect, 'databaseEpoch' | 'readRevision'> & {
  cursorSecret: string;
};
const cursorSchema = z.strictObject({
  version: z.literal(2),
  query: z.string().check(z.regex(/^[0-9a-f]{64}$/u)),
  database_epoch: uuidSchema,
  read_revision: revisionSchema,
  as_of: z.int(),
  offset: z.int().check(z.nonnegative()),
});
/** Call only with the normalized, validated fields defining a collection and its order. */
export function queryFingerprint(query: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(query)).digest('hex');
}
function signature(payload: string, secret: string) {
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`ai-tasks-pagination-v2:${payload}`)
    .digest();
}
function parseCursor(cursor: string, secret: string) {
  try {
    if (cursor.length > 4096) throw new Error('Invalid cursor length');
    const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/u.exec(cursor);
    const payload = parts?.[1];
    const signed = parts?.[2];
    if (!payload || !signed) throw new Error('Invalid cursor encoding');
    const received = Buffer.from(signed, 'base64url');
    if (received.toString('base64url') !== signed || received.length !== 32)
      throw new Error('Noncanonical signature');
    if (!timingSafeEqual(received, signature(payload, secret)))
      throw new Error('Invalid cursor signature');
    const bytes = Buffer.from(payload, 'base64url');
    if (bytes.toString('base64url') !== payload) throw new Error('Noncanonical payload');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    const result = cursorSchema.parse(value);
    formatTimestamp(result.as_of);
    return result;
  } catch {
    throw domainError('VALIDATION_ERROR', 'The pagination cursor is invalid');
  }
}
export function paginationContext(options: {
  state: CursorState;
  query: string;
  now: number;
  cursor: string | undefined;
}) {
  if (options.cursor === undefined) return { offset: 0, asOf: options.now };
  const cursor = parseCursor(options.cursor, options.state.cursorSecret);
  if (
    cursor.database_epoch !== options.state.databaseEpoch ||
    cursor.read_revision !== options.state.readRevision ||
    cursor.query !== options.query
  ) {
    throw domainError(
      'CURSOR_STALE',
      'The pagination context changed; restart from the first page',
    );
  }
  return { offset: cursor.offset, asOf: cursor.as_of };
}
export function nextPageCursor(options: {
  state: CursorState;
  query: string;
  offset: number;
  asOf: number;
}): string {
  const payload = Buffer.from(
    JSON.stringify({
      version: 2,
      query: options.query,
      database_epoch: options.state.databaseEpoch,
      read_revision: options.state.readRevision,
      as_of: options.asOf,
      offset: options.offset,
    }),
  ).toString('base64url');
  return `${payload}.${signature(payload, options.state.cursorSecret).toString('base64url')}`;
}
