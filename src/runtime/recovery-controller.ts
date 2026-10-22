import { trackPending } from './pending-requests.js';
import type { RecoveryServices, RestoreSubmission } from '../api/recovery-port.js';
import { restoreAcceptanceEnvelopeSchema } from '../api/helper-protocol.js';
import { domainError } from '../core/errors.js';
import { getRecoveryStatus } from '../core/recovery/index.js';
import { needsRecovery } from '../core/recovery/startup.js';
import type { RestoreHelperCommand } from '../core/recovery/command.js';
import { startRestoreHelper } from './restore-helper-client.js';
import { createDataGeneration } from './data-generation.js';
import { requestRestoreAcceptance, settleRejectedAcceptance } from './restore-acceptance.js';

type Options = {
  databasePath: string;
  backupDirectory: string;
  onFailure: (error: Error) => void;
};

/** The HTTP owner stays alive while the isolated helper replaces closed generations. */
async function execute(command: RestoreHelperCommand) {
  const helper = await startRestoreHelper();
  try {
    return await helper.request(command);
  } finally {
    await helper.close();
  }
}

function createStatusService(
  backupDirectory: string,
  publication: (jobId: string) => Promise<void> | undefined,
): RecoveryServices['status'] {
  return async (input) => {
    const options = { backupDirectory, ...input };
    let receipt = await getRecoveryStatus(options);
    if (receipt.data.state === 'succeeded' || receipt.data.state === 'failed') {
      const reopening = publication(receipt.data.job_id);
      if (reopening) {
        // A terminal receipt is durable before the HTTP generation starts.
        // For this supervisor's job, finish its bounded reopen before returning
        // that terminal status; queued/running reads remain immediately usable.
        await reopening;
        receipt = await getRecoveryStatus(options);
      }
    }
    return receipt;
  };
}

async function publishAndReopen(options: {
  generation: ReturnType<typeof createDataGeneration>;
  command: RestoreHelperCommand;
  recover: () => Promise<unknown>;
  isClosing: () => boolean;
  finished: () => void;
}) {
  try {
    await options.generation.stop();
    try {
      await execute(options.command);
    } catch {
      // Only exclusive recovery can settle a timeout or disconnected publication.
      await options.recover();
    }
    if (!options.isClosing()) await options.generation.open();
  } catch {
    // Unverified generations remain gated; durable job status stays available.
    await options.generation.stop().catch(() => {});
  } finally {
    options.finished();
  }
}

async function initializeGeneration(
  options: Options,
  generation: ReturnType<typeof createDataGeneration>,
  isClosing: () => boolean,
) {
  if (await needsRecovery(options.databasePath, options.backupDirectory))
    await execute({
      operation: 'recover',
      databasePath: options.databasePath,
      backupDirectory: options.backupDirectory,
    });
  try {
    if (!isClosing()) await generation.open();
  } catch (error) {
    await generation.stop();
    throw error;
  }
}

export function createRecoveryController(options: Options) {
  const generation = createDataGeneration(options);
  let busy = false;
  let closing = false;
  let active: Promise<void> | undefined;
  let activeJobId: string | undefined;
  const submissions = new Set<Promise<unknown>>();
  const paths = { databasePath: options.databasePath, backupDirectory: options.backupDirectory };
  const recover = () => execute({ operation: 'recover', ...paths });
  const initialize = () => initializeGeneration(options, generation, () => closing);
  const perform = (input: RestoreSubmission, jobId: string) =>
    publishAndReopen({
      generation,
      command: {
        operation: 'restore',
        ...paths,
        projectSlug: input.projectSlug,
        envelope: input.envelope,
        actor: input.caller === 'web' ? 'human-web' : `ai-cli:${input.projectSlug}`,
        jobId,
      },
      recover,
      isClosing: () => closing,
      finished: () => {
        activeJobId = undefined;
        busy = false;
      },
    });
  const submit: RecoveryServices['restore'] = async (input) => {
    if (closing || busy || !generation.available())
      throw domainError('MAINTENANCE', 'Database maintenance is in progress');
    busy = true;
    let definiteRejection = false;
    try {
      // pause closes admission synchronously before this first await.
      await generation.pause();
      const response = await requestRestoreAcceptance(() =>
        generation.acceptedRequest({
          operation: 'backup.restore.accept',
          scope: { project_slug: input.projectSlug },
          input: input.envelope,
          caller: input.caller,
        }),
      );
      if (!response.ok) {
        definiteRejection = response.definite;
        throw response.error;
      }
      const accepted = restoreAcceptanceEnvelopeSchema.parse(response.value).data;
      if (!accepted.published) {
        await generation.resume();
        busy = false;
        return accepted.receipt;
      }
      activeJobId = accepted.receipt.data.job_id;
      active = perform(input, activeJobId);
      return accepted.receipt;
    } catch (error) {
      try {
        // Acceptance may have completed after an IPC deadline. Drain its real
        // child, then settle external records under exclusive lock before reopen.
        await settleRejectedAcceptance({
          definite: definiteRejection,
          isClosing: () => closing,
          resume: generation.resume,
          stop: generation.stop,
          needsRecovery: () => needsRecovery(options.databasePath, options.backupDirectory),
          recover,
          open: generation.open,
        });
      } finally {
        busy = false;
      }
      throw error;
    }
  };
  const restore: RecoveryServices['restore'] = (input) => {
    const pending = submit(input);
    trackPending(pending, submissions);
    return pending;
  };
  const services: RecoveryServices = {
    restore,
    status: createStatusService(options.backupDirectory, (jobId) =>
      jobId === activeJobId ? active : undefined,
    ),
  };
  return {
    helper: generation.proxy,
    services,
    initialize,
    async close() {
      closing = true;
      // Drain an accepted publication before tearing down HTTP ownership/mutex.
      await Promise.allSettled([...submissions]);
      await active;
      await generation.proxy.close();
    },
  };
}
