import { afterEach, expect, it, vi } from 'vitest';
import { startWorkerCoordinator } from '../../src/runtime/worker-coordinator.js';

afterEach(() => vi.useRealTimers());

it('discovers all scopes before starting one worker each and reconciles additions, archive and restore every thirty seconds', async () => {
  vi.useFakeTimers();
  let scopes = ['alpha', 'beta'];
  const events: string[] = [];
  const discover = vi.fn(async () => {
    events.push('discovered');
    return scopes;
  });
  const start = vi.fn(async (slug: string) => {
    events.push(`start:${slug}`);
    return {
      close: async () => {
        events.push(`close:${slug}`);
      },
    };
  });
  const onFailure = vi.fn();
  const coordinator = await startWorkerCoordinator({ discover, start, onFailure });
  try {
    expect(events).toEqual(['discovered', 'start:alpha', 'start:beta']);
    scopes = ['beta', 'gamma'];
    await vi.advanceTimersByTimeAsync(29999);
    expect(discover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([
      'discovered',
      'start:alpha',
      'start:beta',
      'discovered',
      'close:alpha',
      'start:gamma',
    ]);
    scopes = ['alpha', 'beta', 'gamma'];
    await vi.advanceTimersByTimeAsync(30000);
    expect(start.mock.calls.map(([slug]) => slug)).toEqual(['alpha', 'beta', 'gamma', 'alpha']);
    expect(onFailure).not.toHaveBeenCalled();
  } finally {
    await coordinator.close();
  }
  expect(events.filter((event) => event === 'close:beta')).toHaveLength(1);
  expect(events.filter((event) => event === 'close:gamma')).toHaveLength(1);
  expect(events.filter((event) => event === 'close:alpha')).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(60000);
  expect(discover).toHaveBeenCalledTimes(3);
});

it('a bounded unstable scope scan preserves existing workers and retries only on the next discovery interval', async () => {
  vi.useFakeTimers();
  let scopes: string[] | undefined = ['alpha'];
  const discover = vi.fn(async () => scopes);
  const close = vi.fn(async () => {});
  const start = vi.fn(async () => ({ close }));
  const coordinator = await startWorkerCoordinator({ discover, start, onFailure: vi.fn() });
  scopes = undefined;
  await vi.advanceTimersByTimeAsync(30000);
  expect(close).not.toHaveBeenCalled();
  expect(start).toHaveBeenCalledTimes(1);
  scopes = [];
  await vi.advanceTimersByTimeAsync(30000);
  expect(close).toHaveBeenCalledTimes(1);
  await coordinator.close();
});

it('overlapping refreshes share discovery and shutdown awaits it without starting late workers', async () => {
  vi.useFakeTimers();
  const pending = Promise.withResolvers<string[]>();
  let next: Promise<string[]> = Promise.resolve(['alpha']);
  const discover = vi.fn(() => next);
  const close = vi.fn(async () => {});
  const start = vi.fn(async () => ({ close }));
  const coordinator = await startWorkerCoordinator({ discover, start, onFailure: vi.fn() });
  next = pending.promise;
  const first = coordinator.refresh();
  const second = coordinator.refresh();
  expect(second).toBe(first);
  const stopped = coordinator.close();
  expect(close).not.toHaveBeenCalled();
  pending.resolve(['alpha', 'new-project']);
  await stopped;
  expect(start).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(coordinator.close()).toBe(stopped);
});

it('startup worker failure drains all other workers and never schedules another discovery', async () => {
  vi.useFakeTimers();
  const close = vi.fn(async () => {});
  const failure = new Error('Worker startup failed');
  const discover = vi.fn(async () => ['alpha', 'beta']);
  await expect(
    startWorkerCoordinator({
      discover,
      start: async (slug) => {
        if (slug === 'beta') throw failure;
        return { close };
      },
      onFailure: vi.fn(),
    }),
  ).rejects.toBe(failure);
  expect(close).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(discover).toHaveBeenCalledTimes(1);
});

it('periodic discovery errors reach the supervisor once for that refresh and existing workers still drain', async () => {
  vi.useFakeTimers();
  let broken = false;
  const failure = new Error('Discovery transport failed');
  const close = vi.fn(async () => {});
  const onFailure = vi.fn();
  const coordinator = await startWorkerCoordinator({
    discover: async () => {
      if (broken) throw failure;
      return ['alpha'];
    },
    start: async () => ({ close }),
    onFailure,
  });
  broken = true;
  await vi.advanceTimersByTimeAsync(30000);
  expect(onFailure).toHaveBeenCalledExactlyOnceWith(failure);
  await coordinator.close();
  expect(close).toHaveBeenCalledTimes(1);
});

it('shutdown during initial startup cancels unfinished workers and drains the workers already started', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const starting = Promise.withResolvers<void>();
  const close = vi.fn(async () => {});
  const onFailure = vi.fn();
  const started = startWorkerCoordinator({
    signal: controller.signal,
    discover: async () => ['alpha', 'beta'],
    start: async (slug) => {
      if (slug === 'alpha') return { close };
      starting.resolve();
      await new Promise<void>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Startup cancelled')), {
          once: true,
        });
      });
      return { close };
    },
    onFailure,
  });
  await starting.promise;
  controller.abort();
  const coordinator = await started;
  await coordinator.close();
  expect(close).toHaveBeenCalledTimes(1);
  expect(onFailure).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('close during an interval worker startup waits for its handle and drains it exactly once', async () => {
  vi.useFakeTimers();
  const pending = Promise.withResolvers<{ close: () => Promise<void> }>();
  const starting = Promise.withResolvers<void>();
  const close = vi.fn(async () => {});
  let scopes = ['alpha'];
  const coordinator = await startWorkerCoordinator({
    discover: async () => scopes,
    start: async (slug) => {
      if (slug === 'alpha') return { close };
      starting.resolve();
      return pending.promise;
    },
    onFailure: vi.fn(),
  });
  scopes = ['alpha', 'beta'];
  const refreshing = coordinator.refresh();
  await starting.promise;
  const stopped = coordinator.close();
  expect(close).not.toHaveBeenCalled();
  pending.resolve({ close });
  await refreshing;
  await stopped;
  expect(close).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('aborting a never-settled startup discovery drains immediately and consumes its later IPC rejection', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const pending = Promise.withResolvers<string[]>();
  const start = vi.fn(async () => ({ close: async () => {} }));
  const onFailure = vi.fn();
  const starting = startWorkerCoordinator({
    signal: controller.signal,
    discover: () => pending.promise,
    start,
    onFailure,
  });
  controller.abort();
  const coordinator = await starting;
  await coordinator.close();
  expect(start).not.toHaveBeenCalled();
  expect(onFailure).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  pending.reject(new Error('Helper closed the pending IPC request'));
  await Promise.resolve();
  await Promise.resolve();
  expect(start).not.toHaveBeenCalled();
  expect(onFailure).not.toHaveBeenCalled();
});
