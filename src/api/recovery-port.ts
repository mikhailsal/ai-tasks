import type { MutationEnvelope } from '../schema/envelopes.js';
import type { RecoveryJobEnvelope } from '../schema/recovery.js';

export type RestoreSubmission = {
  projectSlug: string;
  envelope: MutationEnvelope;
  caller: 'web' | 'cli';
};
export type RecoveryServices = {
  restore: (input: RestoreSubmission) => Promise<RecoveryJobEnvelope>;
  status: (input: { jobId?: string; operationId?: string }) => Promise<RecoveryJobEnvelope>;
};
