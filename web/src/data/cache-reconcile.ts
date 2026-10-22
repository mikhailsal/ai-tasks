type ReconcileOptions = {
  read(): Promise<void>;
  isOnline(): boolean;
  generation(): number;
  ready(): void;
};
/** Share concurrent attempts, but never let an earlier connection authorize a later one. */
export function createReadReconciler(options: ReconcileOptions) {
  let pending: Promise<void> | undefined;
  async function run() {
    while (options.isOnline()) {
      const generation = options.generation();
      try {
        await options.read();
      } catch (error) {
        if (generation !== options.generation() && options.isOnline()) continue;
        throw error;
      }
      if (generation === options.generation() && options.isOnline()) {
        options.ready();
        return;
      }
    }
  }
  return () => {
    pending ??= run().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
