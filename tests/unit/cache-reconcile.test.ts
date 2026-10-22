import { describe, expect, it } from 'vitest';
import { createReadReconciler } from '../../web/src/data/cache-reconcile.js';
function deferred() {
  return Promise.withResolvers<void>();
}
describe('connection generation reconciliation', () => {
  it.each([false, true])(
    'does not unlock B from A after offline/online flapping (A rejection=%s)',
    async (rejectFirst) => {
      let generation = 0;
      let online = true;
      let ready = 0;
      let reads = 0;
      const first = deferred();
      const second = deferred();
      const secondStarted = deferred();
      const reconcile = createReadReconciler({
        generation: () => generation,
        isOnline: () => online,
        ready: () => {
          ready += 1;
        },
        read: () => {
          reads += 1;
          if (reads === 1) return first.promise;
          secondStarted.resolve();
          return second.promise;
        },
      });
      const a = reconcile();
      online = false;
      generation += 1;
      online = true;
      generation += 1;
      const b = reconcile();
      expect(b).toBe(a);
      if (rejectFirst) first.reject(new Error('Old connection failed'));
      else first.resolve();
      await secondStarted.promise;
      expect(reads).toBe(2);
      expect(ready).toBe(0);
      second.resolve();
      await b;
      expect(ready).toBe(1);
    },
  );
  it('stays blocked when the pending read completes offline and performs a new read on reconnect', async () => {
    let online = true;
    let generation = 0;
    let ready = 0;
    let reads = 0;
    const first = deferred();
    const reconcile = createReadReconciler({
      generation: () => generation,
      isOnline: () => online,
      ready: () => {
        ready += 1;
      },
      read: () => {
        reads += 1;
        return reads === 1 ? first.promise : Promise.resolve();
      },
    });
    const pending = reconcile();
    online = false;
    generation += 1;
    first.resolve();
    await pending;
    expect(ready).toBe(0);
    online = true;
    generation += 1;
    await reconcile();
    expect(reads).toBe(2);
    expect(ready).toBe(1);
  });
});
