import { eq } from 'drizzle-orm';
import { applicationState } from '../../schema/entities.js';
import { responseMetaSchema } from '../../schema/envelopes.js';
import { paginationSecrets } from '../../schema/pagination.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { formatTimestamp } from '../time.js';

export function queryState(transaction: DatabaseTransaction) {
  const row = transaction
    .select({ state: applicationState, cursorSecret: paginationSecrets.secret })
    .from(applicationState)
    .innerJoin(paginationSecrets, eq(paginationSecrets.id, 1))
    .where(eq(applicationState.id, 1))
    .get();
  if (!row || typeof row.cursorSecret !== 'string' || !/^[0-9a-f]{64}$/u.test(row.cursorSecret))
    throw domainError('INTERNAL_ERROR', 'Database metadata is unavailable');
  return { ...row.state, cursorSecret: row.cursorSecret };
}

export function queryMetadata(state: ReturnType<typeof queryState>, now: number, asOf?: number) {
  const metadata = responseMetaSchema.safeParse({
    database_epoch: state.databaseEpoch,
    timezone: state.timezone,
    now: formatTimestamp(now),
    read_revision: state.readRevision,
    ...(asOf === undefined ? {} : { as_of: formatTimestamp(asOf) }),
  });
  if (!metadata.success) throw domainError('INTERNAL_ERROR', 'Database metadata is invalid');
  return metadata.data;
}

export { nextPageCursor, paginationContext } from './cursor.js';
