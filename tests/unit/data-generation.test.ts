import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DataHelper } from '../../src/api/helper-client.js';
import type { SuccessEnvelope } from '../../src/schema/envelopes.js';
import { createDataGeneration } from '../../src/runtime/data-generation.js';

const mocks = vi.hoisted(() => ({
  startDataHelper: vi.fn(),
  startProjectWorker: vi.fn(),
}));
vi.mock('../../src/api/helper-client.js', () => ({ startDataHelper: mocks.startDataHelper }));
vi.mock('../../src/api/project-worker-client.js', () => ({
  startProjectWorker: mocks.startProjectWorker,
}));
const result: SuccessEnvelope = {
  ok: true,
  data: {},
  meta: {
    database_epoch: '5baf8967-8c30-4ccc-8fef-e2f917031e71',
    timezone: 'UTC',
    now: '2026-10-22T00:00:00.000Z',
  },
};
const command = { operation: 'meta', scope: { all_projects: true } } as const;
let helpers: DataHelper[];
let helperFailures: ((error: Error) => void)[];
let workerFailures: ((error: Error) => void)[];
let events: string[];
let scopes: string[];

beforeEach(() => {
  vi.useFakeTimers();
  mocks.startDataHelper.mockReset();
  mocks.startProjectWorker.mockReset();
  helpers = [];
  helperFailures = [];
  workerFailures = [];
  events = [];
  scopes = ['alpha'];
  mocks.startDataHelper.mockImplementation(
    async (options: { onUnexpectedFailure: (error: Error) => void }) => {
      helperFailures.push(options.onUnexpectedFailure);
      const id = helpers.length;
      const helper: DataHelper = {
        request: vi.fn(async () => result),
        activeProjectScopes: vi.fn(async () => scopes),
        close: vi.fn(async () => {
          events.push(`helper-close:${id}`);
        }),
      };
      helpers.push(helper);
      return helper;
    },
  );
  mocks.startProjectWorker.mockImplementation(
    async (options: { onUnexpectedFailure: (error: Error) => void }) => {
      workerFailures.push(options.onUnexpectedFailure);
      return {
        close: vi.fn(async () => {
          events.push('worker-close');
        }),
      };
    },
  );
});
afterEach(() => vi.useRealTimers());
function setup() {
  const onFailure = vi.fn();
  return {
    onFailure,
    manager: createDataGeneration({
      databasePath: '/unused/unit.sqlite',
      backupDirectory: '/unused/backups',
      onFailure,
    }),
  };
}

it('gates new requests synchronously, drains accepted requests, and releases workers before the helper', async () => {
  const { manager, onFailure } = setup();
  await manager.open();
  const pending = Promise.withResolvers<SuccessEnvelope>();
  vi.mocked(helpers[0]!.request).mockReturnValueOnce(pending.promise);
  const accepted = manager.proxy.request(command);
  const stopped = manager.stop();
  await expect(manager.proxy.request(command)).rejects.toMatchObject({ code: 'MAINTENANCE' });
  expect(await manager.proxy.activeProjectScopes()).toBeUndefined();
  expect(helpers[0]!.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60000);
  expect(mocks.startProjectWorker).toHaveBeenCalledTimes(1);
  pending.resolve(result);
  expect(await accepted).toEqual(result);
  await stopped;
  expect(events).toEqual(['worker-close', 'helper-close:0']);
  expect(onFailure).not.toHaveBeenCalled();
  await manager.proxy.close();
});

it('keeps the same proxy while replacing generations and ignores delayed old-child failures', async () => {
  const { manager, onFailure } = setup();
  const proxy = manager.proxy;
  await manager.open();
  await manager.stop();
  await manager.open();
  helperFailures[0]?.(new Error('old helper'));
  workerFailures[0]?.(new Error('old worker'));
  expect(onFailure).not.toHaveBeenCalled();
  expect(await proxy.request(command)).toEqual(result);
  helperFailures[1]?.(new Error('current helper'));
  expect(onFailure).toHaveBeenCalledOnce();
  await proxy.close();
});

it('resumes an unchanged generation after rejected acceptance and performs no discovery while paused', async () => {
  const { manager, onFailure } = setup();
  await manager.open();
  await manager.pause();
  const scans = vi.mocked(helpers[0]!.activeProjectScopes).mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(helpers[0]!.activeProjectScopes).toHaveBeenCalledTimes(scans);
  await manager.resume();
  expect(mocks.startDataHelper).toHaveBeenCalledTimes(1);
  expect(mocks.startProjectWorker).toHaveBeenCalledTimes(2);
  workerFailures[0]?.(new Error('late paused worker'));
  expect(await manager.proxy.request(command)).toEqual(result);
  expect(onFailure).not.toHaveBeenCalled();
  await manager.proxy.close();
});

it('refuses admission when an already-ready worker dies while another worker is still starting', async () => {
  const { manager, onFailure } = setup();
  scopes = ['alpha', 'beta'];
  const betaStarted = Promise.withResolvers<void>();
  const betaReady = Promise.withResolvers<void>();
  mocks.startProjectWorker.mockImplementation(
    async (options: { projectSlug: string; onUnexpectedFailure: (error: Error) => void }) => {
      workerFailures.push(options.onUnexpectedFailure);
      if (options.projectSlug === 'beta') {
        betaStarted.resolve();
        await betaReady.promise;
      }
      return {
        close: async () => {
          events.push(`close:${options.projectSlug}`);
        },
      };
    },
  );
  const opening = manager.open();
  await betaStarted.promise;
  workerFailures[0]?.(new Error('startup worker died'));
  betaReady.resolve();
  await expect(opening).rejects.toThrow('startup worker died');
  await expect(manager.proxy.request(command)).rejects.toMatchObject({ code: 'MAINTENANCE' });
  expect(onFailure).not.toHaveBeenCalled();
  await manager.proxy.close();
  expect(events).toEqual(['close:alpha', 'close:beta', 'helper-close:0']);
});
