import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod/mini';
import type { ResponseMeta } from '../../src/schema/envelopes.js';
import type { RestoreResult } from '../../src/schema/recovery.js';
import {
  claimRecoveryJob,
  readRecoveryJob,
  recoveryJobByOperation,
  type RecoveryJobRecord,
} from '../../src/core/recovery/manifests.js';
import { getRecoveryStatus } from '../../src/core/recovery/status.js';

const timestamp = '2026-10-22T00:00:00.000Z';
const uuid = () => randomUUID();

async function createDirectory() {
  return mkdtemp(join(tmpdir(), 'ai-tasks-recovery-jobs-'));
}

function record(
  options: { operationId?: string; jobId?: string; requestHash?: string } = {},
): RecoveryJobRecord {
  const operationId = options.operationId ?? uuid();
  const epoch = uuid();
  return {
    version: 1,
    identity: {
      database_epoch: epoch,
      operation_id: operationId,
      request_hash: options.requestHash ?? 'a'.repeat(64),
      project_slug: 'alpha',
      actor: 'human-web',
      operation: 'backup.restore',
    },
    result: {
      ok: true,
      data: {
        job_id: options.jobId ?? uuid(),
        operation_id: operationId,
        state: 'queued',
        started_at: timestamp,
        finished_at: null,
        result: null,
        error: null,
      },
      meta: {
        database_epoch: epoch,
        timezone: 'Europe/Moscow',
        now: timestamp,
        operation_id: operationId,
        audit_ids: [],
      },
    },
  };
}

async function loadJobsApi() {
  const modulePath = '../../src/core/recovery/jobs.js';
  const loaded: unknown = await import(modulePath);
  const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
    typeof value === 'function';
  return z
    .strictObject({
      runningRecoveryJob:
        z.custom<(directory: string, record: RecoveryJobRecord) => Promise<RecoveryJobRecord>>(
          isFunction,
        ),
      completeRecoveryJob:
        z.custom<
          (
            directory: string,
            record: RecoveryJobRecord,
            options: { result: RestoreResult; meta: ResponseMeta; now?: () => number },
          ) => Promise<RecoveryJobRecord>
        >(isFunction),
      failRecoveryJob:
        z.custom<
          (
            directory: string,
            record: RecoveryJobRecord,
            error: unknown,
            now?: () => number,
          ) => Promise<RecoveryJobRecord>
        >(isFunction),
      sweepAbandonedJobs:
        z.custom<(directory: string, now?: () => number, activeJobId?: string) => Promise<void>>(
          isFunction,
        ),
    })
    .parse(loaded);
}

function restoreResult(): RestoreResult {
  return {
    database_epoch: uuid(),
    affected_projects: ['alpha'],
    audit_ids: [uuid()],
    recovery_snapshot_id: uuid(),
  };
}

function resultMeta(operationId: string): ResponseMeta {
  return {
    database_epoch: uuid(),
    timezone: 'Europe/Moscow',
    now: timestamp,
    operation_id: operationId,
    audit_ids: [],
  };
}

async function inventory(path: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directoryPath: string, prefix = ''): Promise<void> {
    let names: string[];
    try {
      names = await readdir(directoryPath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    for (const name of names.sort()) {
      const child = join(directoryPath, name);
      const relative = prefix ? prefix + '/' + name : name;
      const info = await stat(child);
      if (info.isDirectory()) await walk(child, relative);
      else files.push(relative + ':' + (await readFile(child)).toString('base64'));
    }
  }
  await walk(path);
  return files;
}

it('claims one winner for concurrent identical operations and resolves status to that job', async () => {
  const path = await createDirectory();
  try {
    const first = record();
    const second = record({
      operationId: first.identity.operation_id,
      requestHash: first.identity.request_hash,
    });
    second.identity.database_epoch = first.identity.database_epoch;
    const [left, right] = await Promise.all([
      claimRecoveryJob(path, first),
      claimRecoveryJob(path, second),
    ]);
    expect([left.published, right.published].filter(Boolean)).toHaveLength(1);
    expect(left.record.result.data.job_id).toBe(right.record.result.data.job_id);
    expect(await recoveryJobByOperation(path, first.identity.operation_id)).toEqual(left.record);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

it('rejects a conflicting request hash for the same epoch and operation ID', async () => {
  const path = await createDirectory();
  try {
    const first = record();
    await claimRecoveryJob(path, first);
    const conflict = record({
      operationId: first.identity.operation_id,
      requestHash: 'b'.repeat(64),
    });
    conflict.identity.database_epoch = first.identity.database_epoch;
    await expect(claimRecoveryJob(path, conflict)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

it('transitions queued to running to succeeded and keeps an exact terminal replay immutable', async () => {
  const path = await createDirectory();
  const api = await loadJobsApi();
  try {
    const queued = record();
    await claimRecoveryJob(path, queued);
    const running = await api.runningRecoveryJob(path, queued);
    expect(running.result.data.state).toBe('running');
    const completed = await api.completeRecoveryJob(path, running, {
      result: restoreResult(),
      meta: resultMeta(queued.identity.operation_id),
      now: () => Date.parse('2026-10-22T00:01:00.000Z'),
    });
    expect(completed.result.data.state).toBe('succeeded');
    const result = completed.result.data.result;
    if (!result) throw new Error('Expected successful result');
    const replay = await api.completeRecoveryJob(path, completed, {
      result,
      meta: completed.result.meta,
      now: () => Date.parse('2026-10-22T00:02:00.000Z'),
    });
    expect(replay).toEqual(completed);
    expect(
      (await readRecoveryJob({ backupDirectory: path, jobId: completed.result.data.job_id })).result
        .data.finished_at,
    ).toBe('2026-10-22T00:01:00.000Z');
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

it('preserves a failed terminal state on repeated failure', async () => {
  const path = await createDirectory();
  const api = await loadJobsApi();
  try {
    const queued = record();
    await claimRecoveryJob(path, queued);
    const running = await api.runningRecoveryJob(path, queued);
    const failure = {
      code: 'INTERNAL_ERROR',
      message: 'Restore failed',
      details: null,
      retryable: false,
    };
    const failed = await api.failRecoveryJob(path, running, failure, () =>
      Date.parse('2026-10-22T00:03:00.000Z'),
    );
    const replay = await api.failRecoveryJob(path, failed, failure, () =>
      Date.parse('2026-10-22T00:04:00.000Z'),
    );
    expect(replay).toEqual(failed);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

it('sweeps only stale winning queued or running jobs and preserves active and terminal jobs', async () => {
  const path = await createDirectory();
  const api = await loadJobsApi();
  try {
    const queued = record();
    const runningQueued = record();
    const terminalQueued = record();
    await claimRecoveryJob(path, queued);
    await claimRecoveryJob(path, runningQueued);
    await claimRecoveryJob(path, terminalQueued);
    await api.runningRecoveryJob(path, runningQueued);
    const terminalRunning = await api.runningRecoveryJob(path, terminalQueued);
    const succeeded = await api.completeRecoveryJob(path, terminalRunning, {
      result: restoreResult(),
      meta: resultMeta(terminalQueued.identity.operation_id),
      now: () => Date.parse('2026-10-22T00:01:00.000Z'),
    });

    await api.sweepAbandonedJobs(
      path,
      () => Date.parse('2026-10-22T00:02:00.000Z'),
      queued.result.data.job_id,
    );
    expect(
      (await readRecoveryJob({ backupDirectory: path, jobId: queued.result.data.job_id })).result
        .data.state,
    ).toBe('queued');
    expect(
      (await readRecoveryJob({ backupDirectory: path, jobId: runningQueued.result.data.job_id }))
        .result.data.state,
    ).toBe('failed');
    expect(
      await readRecoveryJob({ backupDirectory: path, jobId: succeeded.result.data.job_id }),
    ).toEqual(succeeded);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

it('resolves job status without a database connection or recovery-storage writes', async () => {
  const path = await createDirectory();
  try {
    const queued = record();
    await claimRecoveryJob(path, queued);
    const before = await inventory(path);
    const status = await getRecoveryStatus({
      backupDirectory: path,
      operationId: queued.identity.operation_id,
      now: () => Date.parse('2026-10-22T00:05:00.000Z'),
    });
    expect(status.data).toEqual(queued.result.data);
    expect(await inventory(path)).toEqual(before);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
