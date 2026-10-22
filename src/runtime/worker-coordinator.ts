type Worker = { close: () => Promise<void> };
type Options = {
  discover: () => Promise<string[] | undefined>;
  start: (projectSlug: string) => Promise<Worker>;
  onFailure: (error: unknown) => void;
  signal?: AbortSignal;
};

function discoverScopes(options: Options): Promise<string[] | undefined> {
  const signal = options.signal;
  if (signal === undefined) return options.discover();
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      resolve(undefined);
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      void options.discover().then(
        (scopes) => {
          cleanup();
          resolve(scopes);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Coordinates validated project scopes and process handles; contains no database rules. */
export async function startWorkerCoordinator(options: Options) {
  const workers = new Map<string, Promise<Worker>>();
  let stopping = false;
  let refreshing: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const timers: { discovery?: ReturnType<typeof setInterval> } = {};
  const reconcile = async () => {
    const scopes = await discoverScopes(options);
    if (stopping || scopes === undefined) return;
    const active = new Set(scopes);
    const removed = [...workers].filter(([slug]) => !active.has(slug));
    await Promise.all(
      removed.map(async ([slug, worker]) => {
        await (await worker).close();
        workers.delete(slug);
      }),
    );
    if (stopping) return;
    const additions = scopes.filter((slug) => !workers.has(slug));
    for (const slug of additions) workers.set(slug, options.start(slug));
    await Promise.all(additions.map((slug) => workers.get(slug)));
  };
  const refresh = () => {
    if (stopping) return Promise.resolve();
    refreshing ??= reconcile().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  };
  const close = () => {
    closing ??= (async () => {
      stopping = true;
      options.signal?.removeEventListener('abort', abort);
      if (timers.discovery !== undefined) clearInterval(timers.discovery);
      await refreshing?.catch(() => {});
      const results = await Promise.allSettled(
        [...workers.values()].map((worker) =>
          worker.then(
            (handle) => handle.close(),
            () => {},
          ),
        ),
      );
      workers.clear();
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    })();
    return closing;
  };
  const abort = () => {
    void close().catch(options.onFailure);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    await refresh();
  } catch (error) {
    await close();
    if (!options.signal?.aborted) throw error;
  }
  if (!stopping)
    timers.discovery = setInterval(() => {
      void refresh().catch(options.onFailure);
    }, 30000);
  return { refresh, close };
}
