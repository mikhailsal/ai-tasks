import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runRecurrenceWorker } from '../../src/runtime/recurrence-worker.js';

beforeEach(() =>
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate'] }),
);
afterEach(() => vi.useRealTimers());
function expectClean(source: EventEmitter) {
  expect(source.listenerCount('SIGINT')).toBe(0);
  expect(source.listenerCount('SIGTERM')).toBe(0);
  expect(source.listenerCount('disconnect')).toBe(0);
  expect(source.listenerCount('message')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
}

it('runs startup once, announces readiness once, and waits exactly thirty seconds for idle work', async () => {
  const events = new EventEmitter();
  const processBatch = vi.fn(() => ({ hasMore: false }));
  const onReady = vi.fn();
  const running = runRecurrenceWorker({ processBatch, onReady, eventSource: events });
  expect(processBatch).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(onReady).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(processBatch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(processBatch).toHaveBeenCalledTimes(2);
  expect(onReady).toHaveBeenCalledTimes(1);
  events.emit('SIGTERM');
  await running;
  expectClean(events);
});

it('more work continues on setImmediate without overlapping asynchronous batches and drains shutdown', async () => {
  const events = new EventEmitter();
  const first = Promise.withResolvers<{ hasMore: boolean }>();
  const second = Promise.withResolvers<{ hasMore: boolean }>();
  const processBatch = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  const onReady = vi.fn();
  const running = runRecurrenceWorker({ processBatch, onReady, eventSource: events });
  await vi.advanceTimersByTimeAsync(90_000);
  expect(processBatch).toHaveBeenCalledTimes(1);
  expect(onReady).not.toHaveBeenCalled();
  first.resolve({ hasMore: true });
  await Promise.resolve();
  expect(onReady).toHaveBeenCalledTimes(1);
  expect(processBatch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(processBatch).toHaveBeenCalledTimes(2);
  events.emit('message', { type: 'shutdown' });
  second.resolve({ hasMore: true });
  await running;
  await vi.advanceTimersByTimeAsync(90_000);
  expect(processBatch).toHaveBeenCalledTimes(2);
  expectClean(events);
});

it.each(['SIGINT', 'SIGTERM', 'disconnect'])(
  '%s during startup drains the batch and suppresses readiness/new passes',
  async (event) => {
    const events = new EventEmitter();
    const existing = vi.fn();
    events.on(event, existing);
    const batch = Promise.withResolvers<{ hasMore: boolean }>();
    const processBatch = vi.fn(() => batch.promise);
    const onReady = vi.fn();
    const running = runRecurrenceWorker({ processBatch, onReady, eventSource: events });
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    events.emit(event);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(existing).toHaveBeenCalledTimes(1);
    batch.resolve({ hasMore: true });
    await running;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(processBatch).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
    expect(events.listeners(event)).toEqual([existing]);
    events.off(event, existing);
    expectClean(events);
  },
);

it('accepts only an exact shutdown IPC message and wakes an idle timer immediately', async () => {
  const events = new EventEmitter();
  const processBatch = vi.fn(() => ({ hasMore: false }));
  const running = runRecurrenceWorker({ processBatch, onReady() {}, eventSource: events });
  await Promise.resolve();
  for (const message of [
    null,
    [],
    'shutdown',
    { type: 'other' },
    { type: 'shutdown', extra: true },
    Object.create({ type: 'shutdown' }),
  ])
    events.emit('message', message);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(processBatch).toHaveBeenCalledTimes(2);
  events.emit('message', { type: 'shutdown' });
  await running;
  expect(processBatch).toHaveBeenCalledTimes(2);
  expectClean(events);
});

it('shutdown emitted by readiness prevents even the first scheduled continuation', async () => {
  const events = new EventEmitter();
  const processBatch = vi.fn(() => ({ hasMore: true }));
  const onReady = vi.fn(() => {
    events.emit('message', { type: 'shutdown' });
  });
  await runRecurrenceWorker({ processBatch, onReady, eventSource: events });
  expect(processBatch).toHaveBeenCalledTimes(1);
  expect(onReady).toHaveBeenCalledTimes(1);
  expectClean(events);
});

it('fatal batch failure propagates unchanged and removes all listeners and waits', async () => {
  const events = new EventEmitter();
  const failure = new Error('batch failed');
  const onReady = vi.fn();
  await expect(
    runRecurrenceWorker({
      processBatch: () => Promise.reject(failure),
      onReady,
      eventSource: events,
    }),
  ).rejects.toBe(failure);
  expect(onReady).not.toHaveBeenCalled();
  expectClean(events);
});

it('readiness failure also propagates with complete cleanup', async () => {
  const events = new EventEmitter();
  const failure = new Error('readiness failed');
  await expect(
    runRecurrenceWorker({
      processBatch: () => ({ hasMore: true }),
      onReady() {
        throw failure;
      },
      eventSource: events,
    }),
  ).rejects.toBe(failure);
  expectClean(events);
});

it('shutdown cancels a queued immediate continuation before another batch can start', async () => {
  const events = new EventEmitter();
  const processBatch = vi.fn(() => ({ hasMore: true }));
  const running = runRecurrenceWorker({ processBatch, onReady() {}, eventSource: events });
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(1);
  events.emit('SIGINT');
  await running;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(processBatch).toHaveBeenCalledTimes(1);
  expectClean(events);
});
