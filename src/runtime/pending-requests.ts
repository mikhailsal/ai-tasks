/** Observe settlement without changing the original caller's promise or result. */
export function trackPending<Value>(pending: Promise<Value>, active: Set<Promise<unknown>>): void {
  active.add(pending);
  void pending.then(
    () => active.delete(pending),
    () => active.delete(pending),
  );
}
