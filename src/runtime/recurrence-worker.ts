import type { EventEmitter } from 'node:events';

function shutdownMessage(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    Reflect.ownKeys(value).length === 1 &&
    Object.getOwnPropertyDescriptor(value, 'type')?.value === 'shutdown'
  );
}

/** Node orchestration only: the caller owns domain batches, retries and readiness output. */
export async function runRecurrenceWorker(options: {
  processBatch: () => Promise<{ hasMore: boolean }> | { hasMore: boolean };
  onReady: () => void;
  eventSource?: EventEmitter;
}): Promise<void> {
  const source = options.eventSource ?? process;
  let stopping = false;
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let immediate: ReturnType<typeof setImmediate> | undefined;
  let wake: (() => void) | undefined;
  const clearWait = () => {
    if (timer !== undefined) clearTimeout(timer);
    if (immediate !== undefined) clearImmediate(immediate);
    timer = undefined;
    immediate = undefined;
  };
  const stop = () => {
    stopping = true;
    clearWait();
    wake?.();
  };
  const message = (value: unknown) => {
    if (shutdownMessage(value)) stop();
  };
  source.on('SIGINT', stop);
  source.on('SIGTERM', stop);
  source.on('disconnect', stop);
  source.on('message', message);
  try {
    while (!stopping) {
      const result = await options.processBatch();
      if (stopping) break;
      if (!ready) {
        ready = true;
        options.onReady();
      }
      if (stopping) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (result.hasMore) immediate = setImmediate(resolve);
        else timer = setTimeout(resolve, 30_000);
      });
      clearWait();
      wake = undefined;
    }
  } finally {
    clearWait();
    wake = undefined;
    source.off('SIGINT', stop);
    source.off('SIGTERM', stop);
    source.off('disconnect', stop);
    source.off('message', message);
  }
}
