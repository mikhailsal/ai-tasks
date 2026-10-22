import { DomainError } from '../core/errors.js';

// These diagnostics originate before claimRecoveryJob publishes any accepted job.
// VALIDATION_ERROR and IDEMPOTENCY_CONFLICT also have post-claim storage origins.
const definiteCodes = new Set([
  'CONFIRMATION_REQUIRED',
  'REVISION_CONFLICT',
  'CONFIG_CONFLICT',
  'DATABASE_EPOCH_CONFLICT',
  'PROJECT_NOT_FOUND',
  'PROJECT_MISMATCH',
  'EMOJI_CONFLICT',
]);

/** Only wrap the remote acceptance call, never local parsing or lifecycle work. */
export async function requestRestoreAcceptance<Output>(request: () => Promise<Output>) {
  try {
    return { ok: true as const, value: await request() };
  } catch (error) {
    return {
      ok: false as const,
      error,
      definite: error instanceof DomainError && definiteCodes.has(error.code),
    };
  }
}

/** Resumption failure still closes the uncertain generation before exclusive recovery. */
export async function settleRejectedAcceptance(options: {
  definite: boolean;
  isClosing: () => boolean;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  needsRecovery: () => Promise<boolean>;
  recover: () => Promise<unknown>;
  open: () => Promise<void>;
}): Promise<void> {
  if (options.definite) {
    if (options.isClosing()) return;
    try {
      await options.resume();
      return;
    } catch {
      /* Fall back to the complete recovery barrier. */
    }
  }
  await options.stop();
  if (await options.needsRecovery()) await options.recover();
  if (!options.isClosing()) await options.open();
}
