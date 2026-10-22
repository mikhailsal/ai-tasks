import { recoveryJobEnvelopeSchema } from '../../schema/recovery.js';
import { publishedOperationalReceipts, readRecoveryJob } from './manifests.js';
import { readRecoveryPhase } from './phase.js';

/** Inspect only external records before opening any normal database generation. */
export async function needsRecovery(
  databasePath: string,
  backupDirectory: string,
): Promise<boolean> {
  if (await readRecoveryPhase(databasePath)) return true;
  for await (const receipt of publishedOperationalReceipts(backupDirectory)) {
    if (receipt.identity.operation !== 'backup.restore') continue;
    const accepted = recoveryJobEnvelopeSchema.parse(receipt.result);
    const record = await readRecoveryJob({ backupDirectory, jobId: accepted.data.job_id });
    if (record.result.data.state === 'queued' || record.result.data.state === 'running')
      return true;
  }
  return false;
}
