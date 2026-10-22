import { performance } from 'node:perf_hooks';
import { z } from 'zod/mini';
import { createReadContext } from '../src/core/context.js';
import { openDatabase } from '../src/core/database/open.js';
import { listTasks } from '../src/core/queries/tasks.js';
import { listAgenda } from '../src/core/queries/agenda.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../src/runtime/database-lock.js';

const benchmarkClock = 1_800_000_000_000;
const query = { all_projects: true, limit: 200 } as const;
const factsSchema = z.strictObject({ changes: z.number(), read_revision: z.number() });
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function materialize(value: unknown) {
  const serialized = JSON.stringify(value);
  const decoded: unknown = JSON.parse(serialized);
  if (!object(decoded) || decoded.ok !== true || !object(decoded.data))
    throw new Error('Production query returned an invalid envelope');
  let rows = 0;
  if (Array.isArray(decoded.data.items)) rows = decoded.data.items.length;
  else if (Array.isArray(decoded.data.groups)) {
    for (const group of decoded.data.groups) {
      if (!object(group) || !Array.isArray(group.items))
        throw new Error('Production agenda returned an invalid group');
      rows += group.items.length;
    }
  } else throw new Error('Production query returned no row collection');
  return { rows, serialized_bytes: Buffer.byteLength(serialized) };
}
function samples(run: () => unknown, warmupCount: number, sampleCount: number) {
  for (let index = 0; index < warmupCount; index += 1) materialize(run());
  const samples_ms: number[] = [];
  const row_counts: number[] = [];
  let serialized_bytes = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const started = performance.now();
    const result = materialize(run());
    samples_ms.push(performance.now() - started);
    row_counts.push(result.rows);
    serialized_bytes = result.serialized_bytes;
  }
  const sorted = samples_ms.toSorted((left, right) => left - right);
  const percentile = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return {
    rows: row_counts.at(-1) ?? 0,
    row_counts,
    serialized_bytes,
    samples_ms,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    max_ms: sorted.at(-1) ?? 0,
  };
}

/** Real production query paths, including complete DTO serialization and consumer materialization. */
export function runQuerySamples(databasePath: string, warmupCount = 10, sampleCount = 500) {
  if (
    !Number.isSafeInteger(warmupCount) ||
    warmupCount < 0 ||
    !Number.isSafeInteger(sampleCount) ||
    sampleCount < 1
  )
    throw new Error('Benchmark sample counts must be nonnegative warmups and positive samples');
  const lock = acquireDatabaseLock({ databasePath, mode: 'shared' });
  try {
    const connection = openDatabase({ path: lock.databasePath, lock, now: () => benchmarkClock });
    try {
      const facts = () =>
        factsSchema.parse(
          connection.sqlite
            .prepare(
              'SELECT total_changes() AS changes, (SELECT read_revision FROM application_state WHERE id=1) AS read_revision',
            )
            .get(),
        );
      const before = facts();
      const context = createReadContext({ connection, now: () => benchmarkClock });
      const task_list = samples(() => listTasks(context, query), warmupCount, sampleCount);
      const agenda = samples(() => listAgenda(context, query), warmupCount, sampleCount);
      const after = facts();
      if (after.changes !== before.changes || after.read_revision !== before.read_revision)
        throw new Error('Benchmark queries changed database state');
      return {
        clock: benchmarkClock,
        clock_utc: new Date(benchmarkClock).toISOString(),
        warmup_count: warmupCount,
        sample_count: sampleCount,
        task_list,
        agenda,
        query_facts: {
          input: query,
          timing: 'query + JSON.stringify + JSON.parse + exact materialized row count',
          percentile_method: 'nearest rank',
          total_changes_delta: after.changes - before.changes,
          read_revision_before: before.read_revision,
          read_revision_after: after.read_revision,
          connection_count: 1,
          lock_mode: 'shared',
        },
      };
    } finally {
      connection.close();
    }
  } finally {
    releaseDatabaseLock(lock);
  }
}
