import { createHash } from 'node:crypto';
import { backupListEnvelopeSchema, backupListInputSchema } from '../../schema/recovery.js';
import { queryFingerprint, paginationContext, nextPageCursor } from '../queries/cursor.js';
import { parseInput } from '../validation.js';
import { formatTimestamp, parseTimestamp } from '../time.js';
import { canonicalManagedDirectory } from './files.js';
import { publishedBackupReceipts, readBackupManifest } from './manifests.js';
import { recoveryRead, type RecoveryReadContext } from './guards.js';

export async function listManagedBackups(
  context: RecoveryReadContext,
  input: unknown,
  directory: string,
) {
  const query = parseInput(backupListInputSchema, input);
  const { state, meta } = recoveryRead(context);
  const inventory = createHash('sha256');
  const summaries: { id: string; createdAt: string }[] = [];
  for await (const receipt of publishedBackupReceipts(directory)) {
    inventory.update(JSON.stringify(receipt));
    summaries.push({ id: receipt.result.data.id, createdAt: receipt.result.data.created_at });
  }
  summaries.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
  const fingerprint = queryFingerprint({
    family: 'backups',
    limit: query.limit,
    directory: await canonicalManagedDirectory(directory),
    inventory: inventory.digest('hex'),
  });
  const page = paginationContext({
    state,
    query: fingerprint,
    now: parseTimestamp(meta.now),
    cursor: query.cursor,
  });
  const selected = summaries.slice(page.offset, page.offset + query.limit + 1);
  const hasMore = selected.length > query.limit;
  const items = [];
  for (const summary of selected.slice(0, query.limit)) {
    items.push((await readBackupManifest(directory, summary.id)).result.data);
  }
  return backupListEnvelopeSchema.parse({
    ok: true,
    data: {
      items,
      next_cursor: hasMore
        ? nextPageCursor({
            state,
            query: fingerprint,
            offset: page.offset + query.limit,
            asOf: page.asOf,
          })
        : null,
    },
    meta: { ...meta, as_of: formatTimestamp(page.asOf) },
  });
}
