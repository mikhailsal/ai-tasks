import { afterEach, expect, it, vi } from 'vitest';
import { retryStartup } from '../../src/runtime/startup-retry.js';

afterEach(() => vi.useRealTimers());

it('retries bounded unsuccessful recovery attempts and announces readiness only after success', async () => {
  vi.useFakeTimers();
  const start = vi.fn(async () => {});
  start
    .mockRejectedValueOnce(new Error('exclusive holder'))
    .mockRejectedValueOnce(new Error('still held'));
  const controller = new AbortController();
  let ready = false;
  const pending = retryStartup({ signal: controller.signal, start }).then((value) => {
    ready = value;
    return value;
  });
  await vi.advanceTimersByTimeAsync(1999);
  expect(start).toHaveBeenCalledTimes(2);
  expect(ready).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toBe(true);
  expect(start).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels a maintenance retry immediately on shutdown and starts no late attempt', async () => {
  vi.useFakeTimers();
  const start = vi.fn(async () => {
    throw new Error('malformed phase');
  });
  const controller = new AbortController();
  const pending = retryStartup({ signal: controller.signal, start });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  expect(await pending).toBe(false);
  await vi.advanceTimersByTimeAsync(30000);
  expect(start).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
