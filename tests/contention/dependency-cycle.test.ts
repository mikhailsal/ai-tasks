import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { z } from 'zod/mini';
import { errorEnvelopeSchema, mutationSuccessEnvelopeSchema } from '../../src/schema/envelopes.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import { createProcessBarrier } from '../fixtures/process-barrier.js';
import {
  createOrdinaryFixture,
  initialWork,
  ordinaryInput,
  durableCounts,
  invokeOrdinaryCli,
} from '../fixtures/ordinary-work.js';
import { jsonValueSchema } from '../../src/schema/values.js';
const resultSchema = z.object({
  type: z.literal('result'),
  workerId: z.number(),
  workerPid: z.number(),
  cliPid: z.number(),
  exitCode: z.number(),
  signal: z.null(),
  stdout: z.string(),
  stderr: z.string(),
});
function resultFrom(child: ChildProcess) {
  return new Promise<z.output<typeof resultSchema>>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const onMessage = (message: unknown) => {
      const parsed = resultSchema.safeParse(message);
      if (!parsed.success) return;
      cleanup();
      resolve(parsed.data);
    };
    const onExit = () => {
      cleanup();
      reject(new Error('Dependency worker exited before result'));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Dependency writers exceeded their result deadline'));
    }, 25000);
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}
it('opposing CLI writers at a real process barrier commit one edge and reject the cycle atomically', async () => {
  const fixture = await createOrdinaryFixture();
  const barriers: ReturnType<typeof createProcessBarrier>[] = [];
  try {
    const { task, betaTask } = await initialWork(fixture);
    const writes = [
      {
        taskId: task.id,
        slug: 'alpha',
        input: ordinaryInput(
          fixture,
          { prerequisite_task_id: betaTask.id, prerequisite_project_slug: 'beta' },
          { revision: 1 },
        ),
      },
      {
        taskId: betaTask.id,
        slug: 'beta',
        input: ordinaryInput(
          fixture,
          { prerequisite_task_id: task.id, prerequisite_project_slug: 'alpha' },
          { projectSlug: 'beta', revision: 1 },
        ),
      },
    ];
    const before = durableCounts(fixture);
    const barrier = createProcessBarrier(2, {
      modulePath: fileURLToPath(new URL('../fixtures/dependency-worker.mjs', import.meta.url)),
      workerArgs: [fixture.path, JSON.stringify(writes)],
    });
    barriers.push(barrier);
    const pending = barrier.workers.map(({ child }) => resultFrom(child));
    await barrier.waitForReady(10000);
    barrier.release();
    const results = await Promise.all(pending);
    expect(new Set(results.map((result) => result.workerPid)).size).toBe(2);
    expect(new Set(results.map((result) => result.cliPid)).size).toBe(2);
    expect(results.map((result) => result.exitCode).sort()).toEqual([0, 4]);
    const winner = results.find((result) => result.exitCode === 0);
    const loser = results.find((result) => result.exitCode !== 0);
    if (!winner || !loser) throw new Error('Missing writer result');
    expect(winner.stderr).toBe('');
    expect(loser.stdout).toBe('');
    expect(errorEnvelopeSchema.parse(JSON.parse(loser.stderr)).error.code).toBe(
      'DEPENDENCY_BLOCKED',
    );
    const success = mutationSuccessEnvelopeSchema.parse(JSON.parse(winner.stdout));
    const write = writes[winner.workerId];
    const refused = writes[loser.workerId];
    if (!write || !refused) throw new Error('Missing writer input');
    expect(taskDetailSchema.parse(success.data)).toMatchObject({
      id: write.taskId,
      revision: 2,
      status_id: 'idea',
    });
    expect(
      fixture.connection.sqlite
        .prepare('SELECT dependent_task_id, prerequisite_task_id FROM task_dependencies')
        .all(),
    ).toEqual([
      {
        dependent_task_id: write.taskId,
        prerequisite_task_id:
          write.input.payload &&
          typeof write.input.payload === 'object' &&
          !Array.isArray(write.input.payload)
            ? write.input.payload.prerequisite_task_id
            : null,
      },
    ]);
    expect(
      fixture.connection.sqlite
        .prepare('SELECT revision, status_id FROM tasks WHERE id=?')
        .get(refused.taskId),
    ).toEqual({ revision: 1, status_id: 'idea' });
    expect(durableCounts(fixture)).toEqual({
      audit: Number(before.audit) + 1,
      receipt: Number(before.receipt) + 1,
    });
    expect(
      fixture.connection.sqlite
        .prepare(
          'SELECT actor, origin, operation_id FROM audit_records WHERE operation_id IN (?,?)',
        )
        .all(write.input.operation_id, refused.input.operation_id),
    ).toEqual([
      { actor: `ai-cli:${write.slug}`, origin: 'cli', operation_id: write.input.operation_id },
    ]);
    expect(
      fixture.connection.sqlite
        .prepare('SELECT operation_id FROM operation_receipts WHERE operation_id IN (?,?)')
        .all(write.input.operation_id, refused.input.operation_id),
    ).toEqual([{ operation_id: write.input.operation_id }]);
    const { payload, ...guards } = write.input;
    const replay = invokeOrdinaryCli(
      fixture,
      ['dependency', 'add', write.taskId, '--project', write.slug, '--input', '-', '--json'],
      jsonValueSchema.parse({ ...guards, ...z.record(z.string(), jsonValueSchema).parse(payload) }),
    );
    expect(replay.status, replay.stderr).toBe(0);
    expect(mutationSuccessEnvelopeSchema.parse(JSON.parse(replay.stdout))).toEqual(success);
    expect(durableCounts(fixture)).toEqual({
      audit: Number(before.audit) + 1,
      receipt: Number(before.receipt) + 1,
    });
  } finally {
    await Promise.all(barriers.map((barrier) => barrier.close()));
    await fixture.close();
  }
});
