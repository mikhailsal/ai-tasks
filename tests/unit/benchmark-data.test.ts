import { expect, it } from 'vitest';
import { z } from 'zod/mini';
import { createReadContext } from '../../src/core/context.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { openDatabase } from '../../src/core/database/open.js';
import { getTask, listTasks } from '../../src/core/queries/tasks.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createTestClock } from '../fixtures/clock.js';
import { createDatabaseFixture } from '../fixtures/database.js';
import { seedBenchmarkData } from '../fixtures/benchmark-data.js';

it('seeds deterministic production-schema rows with valid recurrence, foreign keys, and immutable audit', async () => {
  const clock = createTestClock(1_800_000_100_000);
  let opened: ReturnType<typeof openDatabase> | undefined;
  const fixture = await createDatabaseFixture(
    {
      acquireDatabaseLock,
      releaseDatabaseLock,
      openDatabase(input) {
        opened = openDatabase(input);
        return opened;
      },
      migrateDatabase,
    },
    clock,
  );
  try {
    const connection = opened;
    if (!connection) throw new Error('Benchmark database did not open');
    const size = { projects: 2, tasks: 4, occurrences: 6, audits: 5 };
    expect(seedBenchmarkData(connection.sqlite, size)).toMatchObject(size);
    expect(connection.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(connection.sqlite.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(
      connection.sqlite
        .prepare('SELECT state, count(*) AS count FROM occurrences GROUP BY state ORDER BY state')
        .all(),
    ).toEqual([
      { state: 'completed', count: 2 },
      { state: 'debt', count: 2 },
      { state: 'pending', count: 2 },
    ]);
    for (const [table, count] of Object.entries({
      projects: size.projects,
      tasks: size.tasks,
      occurrences: size.occurrences,
      audit_records: size.audits,
    })) {
      expect(connection.sqlite.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(count);
    }
    expect(() =>
      connection.sqlite.prepare('UPDATE audit_records SET action = ?').run('changed'),
    ).toThrow();
    const before = connection.sqlite
      .prepare('SELECT read_revision FROM application_state')
      .pluck()
      .get();
    const result = listTasks(createReadContext({ connection, now: clock.now }), {
      all_projects: true,
      limit: 200,
    });
    expect(result.data.items).toHaveLength(4);
    expect(JSON.stringify(result)).toContain('Task 1');
    const recurringId = z
      .string()
      .parse(
        connection.sqlite
          .prepare(
            "SELECT id FROM tasks WHERE project_slug = 'project-01' AND kind = 'recurring' LIMIT 1",
          )
          .pluck()
          .get(),
      );
    expect(
      getTask(createReadContext({ connection, now: clock.now }), 'project-01', recurringId).ok,
    ).toBe(true);
    expect(
      connection.sqlite.prepare('SELECT read_revision FROM application_state').pluck().get(),
    ).toBe(before);
  } finally {
    await fixture.close();
  }
});
