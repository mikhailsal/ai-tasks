import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { createContext } from '../../src/core/context.js';
import { openDatabase } from '../../src/core/database/open.js';
import { listProjects } from '../../src/core/queries/projects.js';
import { listTasks } from '../../src/core/queries/tasks.js';
import { readMeta } from '../../src/core/queries/meta.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import {
  createOrdinaryFixture,
  initialWork,
  ordinarySnapshot,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  await initialWork(fixture);
});
afterEach(() => fixture?.close());
function firstPage() {
  const first = listProjects(fixture.human, { all_projects: true, limit: 1 });
  if (!first.data.next_cursor) throw new Error('Fixture needs a second page');
  return { first, cursor: first.data.next_cursor };
}
// Preserve the signature segment, if present. The old unsigned format can also be
// altered, making the regression a real accepted forged-clock assertion before T052.
function alterCursor(
  cursor: string,
  change: {
    as_of?: number;
    offset?: number;
  },
) {
  const [payload, ...suffix] = cursor.split('.');
  if (!payload) throw new Error('Missing cursor payload');
  const parsed = z
    .looseObject(z.object({ as_of: z.number(), offset: z.number() }).shape)
    .parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  return [
    Buffer.from(JSON.stringify({ ...parsed, ...change })).toString('base64url'),
    ...suffix,
  ].join('.');
}
it.each([{ as_of: 0 }, { offset: 0 }, { offset: 9007199254740991 }])(
  'rejects an altered server pagination payload %j without writes',
  (change) => {
    const { cursor } = firstPage();
    const before = ordinarySnapshot(fixture);
    expect(() =>
      listProjects(fixture.human, {
        all_projects: true,
        limit: 1,
        cursor: alterCursor(cursor, change),
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(ordinarySnapshot(fixture)).toEqual(before);
  },
);
it('binds project and task collection identity and never accepts a caller clock', () => {
  const { cursor } = firstPage();
  const before = ordinarySnapshot(fixture);
  expect(() => listTasks(fixture.human, { all_projects: true, limit: 1, cursor })).toThrowError(
    expect.objectContaining({ code: 'CURSOR_STALE' }),
  );
  for (const input of [
    { all_projects: true as const, as_of: '2020-01-01T00:00:00.000Z' },
    { all_projects: true as const, now: 0 },
  ]) {
    expect(() => listProjects(fixture.human, input)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(() => listTasks(fixture.human, input)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  }
  expect(ordinarySnapshot(fixture)).toEqual(before);
});
it('retains the original cursor clock across a new connection and a later actual clock', () => {
  const { first, cursor } = firstPage();
  const lock = acquireDatabaseLock({ databasePath: fixture.path, mode: 'shared' });
  const connection = openDatabase({ path: fixture.path, lock, now: fixture.clock.now });
  try {
    fixture.clock.advanceBy(86400000);
    const reopened = createContext({ connection, actor: 'human-web', now: fixture.clock.now });
    const before = ordinarySnapshot(fixture);
    const second = listProjects(reopened, { all_projects: true, limit: 1, cursor });
    expect(second.data.items.map((row) => row.slug)).toEqual(['beta']);
    expect(second.meta.as_of).toBe(first.meta.as_of);
    expect(second.meta.now).toBe(new Date(fixture.clock.now()).toISOString());
    expect(second.meta.now).not.toBe(second.meta.as_of);
    expect(listProjects(reopened, { all_projects: true, limit: 1 }).meta.as_of).toBe(
      second.meta.now,
    );
    expect(ordinarySnapshot(fixture)).toEqual(before);
  } finally {
    connection.close();
    releaseDatabaseLock(lock);
  }
});
it('rejects a token from a different database even with the same public epoch/revision', async () => {
  const { cursor } = firstPage();
  const other = await createOrdinaryFixture();
  try {
    await initialWork(other);
    other.connection.sqlite
      .prepare('UPDATE application_state SET database_epoch = ? WHERE id = 1')
      .run(fixture.epoch);
    const before = ordinarySnapshot(other);
    expect(() => listProjects(other.human, { all_projects: true, limit: 1, cursor })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(ordinarySnapshot(other)).toEqual(before);
  } finally {
    await other.close();
  }
});
it('keeps the migration-created key private and never writes during cursor generation', () => {
  const row = z
    .object({ secret: z.string().check(z.regex(/^[0-9a-f]{64}$/u)) })
    .parse(
      fixture.connection.sqlite.prepare('SELECT secret FROM pagination_secrets WHERE id=1').get(),
    );
  const changes = fixture.connection.sqlite.prepare('SELECT total_changes() AS count').get();
  const resources = [
    readMeta(fixture.human, { all_projects: true }),
    listProjects(fixture.human, { all_projects: true, limit: 1 }),
    listTasks(fixture.human, { all_projects: true, limit: 1 }),
  ];
  expect(JSON.stringify(resources)).not.toContain(row.secret);
  expect(fixture.connection.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(
    changes,
  );
});
it('fails closed on missing private metadata without initializing it from a read', () => {
  fixture.connection.sqlite.prepare('DELETE FROM pagination_secrets').run();
  const changes = fixture.connection.sqlite.prepare('SELECT total_changes() AS count').get();
  expect(() => listProjects(fixture.human, { all_projects: true })).toThrowError(
    expect.objectContaining({ code: 'INTERNAL_ERROR' }),
  );
  expect(fixture.connection.sqlite.prepare('SELECT * FROM pagination_secrets').all()).toEqual([]);
  expect(fixture.connection.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(
    changes,
  );
});
it('rejects NUL-suffixed private keys at the actual SQLite constraint', () => {
  const before = fixture.connection.sqlite.prepare('SELECT * FROM pagination_secrets').all();
  expect(() =>
    fixture.connection.sqlite
      .prepare('UPDATE pagination_secrets SET secret=? WHERE id=1')
      .run(`${'a'.repeat(64)}\0INVALID`),
  ).toThrow();
  expect(fixture.connection.sqlite.prepare('SELECT * FROM pagination_secrets').all()).toEqual(
    before,
  );
});
