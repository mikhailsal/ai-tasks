import { trackPending } from './pending-requests.js';
import { startDataHelper, type DataHelper } from '../api/helper-client.js';
import { startProjectWorker } from '../api/project-worker-client.js';
import { domainError } from '../core/errors.js';
import { startWorkerCoordinator } from './worker-coordinator.js';

type Options = {
  databasePath: string;
  backupDirectory: string;
  onFailure: (error: Error) => void;
};

/** Stable HTTP proxy with admission control across complete database generations. */
export function createDataGeneration(options: Options) {
  let helper: DataHelper | undefined;
  let workers: Awaited<ReturnType<typeof startWorkerCoordinator>> | undefined;
  let workerAbort = new AbortController();
  let generation = 0;
  let workerGeneration = 0;
  let blocked = true;
  let closing = false;
  let generationFailure: Error | undefined;
  const accepted = new Set<Promise<unknown>>();
  const unavailable = () => domainError('MAINTENANCE', 'Database maintenance is in progress');
  const failureFor = (identity: number) => (error: Error) => {
    if (identity !== generation || closing) return;
    if (blocked) generationFailure ??= error;
    else options.onFailure(error);
  };
  const request: DataHelper['request'] = (command) => {
    if (blocked || !helper) return Promise.reject(unavailable());
    const pending = helper.request(command);
    trackPending(pending, accepted);
    return pending;
  };
  const pause = async () => {
    blocked = true;
    workerGeneration += 1;
    workerAbort.abort();
    await Promise.allSettled([...accepted]);
    await workers?.close();
    workers = undefined;
  };
  const resume = async () => {
    const current = helper;
    if (!current || closing) throw unavailable();
    const identity = generation;
    const workerIdentity = ++workerGeneration;
    const workerFailure = (error: Error) => {
      if (workerIdentity === workerGeneration) failureFor(identity)(error);
    };
    workerAbort = new AbortController();
    const signal = workerAbort.signal;
    workers = await startWorkerCoordinator({
      signal,
      discover: () => (signal.aborted ? Promise.resolve(undefined) : current.activeProjectScopes()),
      start: (projectSlug) =>
        startProjectWorker({
          databasePath: options.databasePath,
          projectSlug,
          onUnexpectedFailure: workerFailure,
          signal,
        }),
      onFailure: (error) =>
        workerFailure(
          error instanceof Error ? error : new Error('Recurring worker is unavailable'),
        ),
    });
    if (generationFailure) {
      await workers.close();
      throw generationFailure;
    }
    if (!closing && !signal.aborted) blocked = false;
  };
  const open = async () => {
    if (closing) throw unavailable();
    const identity = ++generation;
    generationFailure = undefined;
    helper = await startDataHelper({
      databasePath: options.databasePath,
      backupDirectory: options.backupDirectory,
      onUnexpectedFailure: failureFor(identity),
    });
    await resume();
  };
  const stop = async () => {
    await pause();
    const previous = helper;
    helper = undefined;
    await previous?.close();
  };
  const proxy: DataHelper = {
    request,
    activeProjectScopes: () =>
      blocked || !helper ? Promise.resolve(undefined) : helper.activeProjectScopes(),
    close: async () => {
      closing = true;
      await stop();
    },
  };
  return {
    proxy,
    open,
    pause,
    resume,
    stop,
    available: () => !blocked && helper !== undefined,
    acceptedRequest: (command: Parameters<DataHelper['request']>[0]) => {
      if (!helper) return Promise.reject(unavailable());
      return helper.request(command);
    },
  };
}
