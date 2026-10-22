function waitForRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, 1000);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** Retry bounded recovery attempts while the already-bound maintenance listener stays alive. */
export async function retryStartup(options: {
  signal: AbortSignal;
  start: () => Promise<void>;
}): Promise<boolean> {
  while (!options.signal.aborted) {
    try {
      await options.start();
      return !options.signal.aborted;
    } catch {
      // Each attempt owns and drains its children; a lock timeout is no evidence
      // that an external holder or an unfinished durable phase is abandoned.
      await waitForRetry(options.signal);
    }
  }
  return false;
}
