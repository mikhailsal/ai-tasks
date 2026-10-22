import { ChildProcess, fork } from 'node:child_process';
import type * as childProcessModule from 'node:child_process';
import type * as fsModule from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startRestoreHelper } from '../../src/runtime/restore-helper-client.js';

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof childProcessModule>()),
  fork: vi.fn(),
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof fsModule>()),
  existsSync: vi.fn(() => true),
}));

let child: ChildProcess;
beforeEach(() => {
  vi.useFakeTimers();
  child = new ChildProcess();
  Object.defineProperty(child, 'pid', { value: 12345 });
  Object.defineProperty(child, 'connected', { value: true, configurable: true });
  Object.defineProperty(child, 'send', { value: vi.fn(() => true), configurable: true });
  vi.spyOn(child, 'kill').mockImplementation(() => {
    exit(null, 'SIGKILL');
    return true;
  });
  vi.mocked(fork).mockReturnValue(child);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function exit(code: number | null = 0, signal: NodeJS.Signals | null = null) {
  Object.defineProperties(child, {
    exitCode: { value: code, configurable: true },
    signalCode: { value: signal, configurable: true },
    connected: { value: false, configurable: true },
  });
  child.emit('exit', code, signal);
}
async function ready() {
  const starting = startRestoreHelper();
  child.emit('message', { type: 'ready', version: 1 });
  return starting;
}
function requestId() {
  const sent = vi.mocked(child.send).mock.calls[0]?.[0];
  if (sent === null || typeof sent !== 'object' || !('id' in sent)) throw new Error('No request');
  return sent.id;
}
const recover = { operation: 'recover', databasePath: '/tmp/live.sqlite' } as const;

it('uses isolated stdio and settles a valid result only after clean child exit', async () => {
  const helper = await ready();
  expect(fork).toHaveBeenCalledWith(expect.any(String), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    execArgv: [],
    serialization: 'json',
  });
  let settled = false;
  const result = helper.request(recover).then((value) => {
    settled = true;
    return value;
  });
  child.emit('message', { type: 'result', id: requestId(), result: null });
  await Promise.resolve();
  expect(settled).toBe(false);
  exit();
  await expect(result).resolves.toBeNull();
  await helper.close();
  expect(vi.getTimerCount()).toBe(0);
});

it('rejects a second same-turn request instead of starting a second exclusive operation', async () => {
  const helper = await ready();
  const first = helper.request(recover);
  await expect(helper.request(recover)).rejects.toMatchObject({ code: 'MAINTENANCE' });
  expect(child.send).toHaveBeenCalledTimes(1);
  child.emit('message', { type: 'result', id: requestId(), result: null });
  exit();
  await first;
});

it('preserves a stable domain failure but still waits for released child lifetime', async () => {
  const helper = await ready();
  const result = helper.request(recover);
  const assertion = expect(result).rejects.toMatchObject({ code: 'DB_CONFLICT' });
  child.emit('message', {
    type: 'failure',
    id: requestId(),
    error: {
      ok: false,
      error: { code: 'DB_CONFLICT', message: 'Database is busy', details: null, retryable: true },
    },
  });
  exit();
  await assertion;
});

it.each(['wrong-id', 'wrong-result', 'abnormal-exit'])(
  'treats %s as indeterminate maintenance',
  async (kind) => {
    const helper = await ready();
    const result = helper.request(recover);
    const assertion = expect(result).rejects.toMatchObject({ code: 'MAINTENANCE' });
    child.emit('message', {
      type: 'result',
      id: kind === 'wrong-id' ? randomUUID() : requestId(),
      result: kind === 'wrong-result' ? {} : null,
    });
    if (kind === 'abnormal-exit') exit(1);
    await assertion;
  },
);

it('aborted startup drains shutdown then kills after five seconds without leaving timers', async () => {
  const controller = new AbortController();
  const starting = startRestoreHelper({ signal: controller.signal });
  const assertion = expect(starting).rejects.toMatchObject({ code: 'MAINTENANCE' });
  controller.abort();
  expect(child.send).toHaveBeenCalledWith({ type: 'shutdown' }, expect.any(Function));
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  expect(vi.getTimerCount()).toBe(0);
});

it('operation timeout requests drain, then forces exit before reporting maintenance', async () => {
  const helper = await ready();
  const result = helper.request(recover);
  const assertion = expect(result).rejects.toMatchObject({ code: 'MAINTENANCE' });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(child.send).toHaveBeenLastCalledWith({ type: 'shutdown' }, expect.any(Function));
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it('a synchronous IPC send race drains the child and reports a safe indeterminate error', async () => {
  const helper = await ready();
  vi.mocked(child.send).mockImplementationOnce(() => {
    throw new Error('private channel path');
  });
  const assertion = expect(helper.request(recover)).rejects.toMatchObject({ code: 'MAINTENANCE' });
  expect(child.send).toHaveBeenLastCalledWith({ type: 'shutdown' }, expect.any(Function));
  exit();
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
