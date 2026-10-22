import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createContext } from '../../src/core/context.js';
import { executeMutation } from '../../src/core/database/mutate.js';
import { projects } from '../../src/schema/entities.js';
import {
  createMutationFixture,
  mutationSnapshot,
  type MutationFixture,
} from '../fixtures/mutation-seed.js';

const eventCount = 5_000;
let fixture: MutationFixture;
beforeEach(async () => {
  fixture = await createMutationFixture();
});
afterEach(async () => {
  await fixture?.close();
});

function batchMutation(rejectLast = false) {
  return executeMutation({
    context: createContext({ connection: fixture.connection, actor: 'human-web' }),
    operation: 'test.project.archive_batch',
    projectSlug: 'alpha',
    input: {
      operation_id: randomUUID(),
      database_epoch: fixture.epoch,
      expected_revision: 1,
      expected_config_revision: 1,
      expected_settings_revision: 1,
      payload: { affected_count: eventCount },
    },
    handler(transaction) {
      transaction.update(projects).set({ priority: 5 }).where(eq(projects.slug, 'alpha')).run();
      return {
        data: { affected_count: eventCount },
        events: Array.from({ length: eventCount }, (_, index) => ({
          entity_type: 'project',
          entity_id: fixture.ids.alpha,
          action: rejectLast && index === eventCount - 1 ? 'reject_batch' : 'batch_member',
          changes: [{ field: 'member_index', before: null, after: index }],
        })),
      };
    },
  });
}

it('commits a batch larger than the native bind limit with ordered audit IDs and one receipt', () => {
  const options = fixture.connection.sqlite.prepare('PRAGMA compile_options').pluck().all();
  const variableLimit = options.find(
    (option): option is string =>
      typeof option === 'string' && option.startsWith('MAX_VARIABLE_NUMBER='),
  );
  expect(variableLimit).toBeDefined();
  expect(eventCount * 13).toBeGreaterThan(Number(variableLimit?.split('=')[1]));
  const initialRevision = fixture.connection.sqlite
    .prepare('SELECT read_revision FROM application_state')
    .pluck()
    .get();
  const result = batchMutation();
  const audits = fixture.connection.sqlite
    .prepare('SELECT id, changes FROM audit_records ORDER BY rowid')
    .all();
  expect(audits).toHaveLength(eventCount);
  expect(result.meta.audit_ids).toHaveLength(eventCount);
  expect(audits).toEqual(
    result.meta.audit_ids.map((id, index) => ({
      id,
      changes: JSON.stringify([{ field: 'member_index', before: null, after: index }]),
    })),
  );
  expect(
    fixture.connection.sqlite
      .prepare('SELECT priority FROM projects WHERE slug = ?')
      .pluck()
      .get('alpha'),
  ).toBe(5);
  expect(
    fixture.connection.sqlite.prepare('SELECT count(*) FROM operation_receipts').pluck().get(),
  ).toBe(1);
  expect(
    fixture.connection.sqlite.prepare('SELECT read_revision FROM application_state').pluck().get(),
  ).toBe(Number(initialRevision) + 1);
  const receipt = fixture.connection.sqlite
    .prepare('SELECT result FROM operation_receipts')
    .pluck()
    .get();
  expect(typeof receipt).toBe('string');
  expect(typeof receipt === 'string' ? JSON.parse(receipt) : null).toEqual(result);
});

it('rolls back domain state and all earlier audit batches when the final insert fails', () => {
  const sqlite = fixture.connection.sqlite;
  let attemptedRows = 0;
  sqlite.function('observe_audit_insert', () => {
    attemptedRows += 1;
    return 1;
  });
  sqlite.exec(`
    CREATE TEMP TRIGGER observe_audit_batch BEFORE INSERT ON audit_records
    BEGIN SELECT observe_audit_insert(); END;
    CREATE TEMP TRIGGER reject_late_audit BEFORE INSERT ON audit_records
    WHEN NEW.action = 'reject_batch'
    BEGIN SELECT RAISE(ABORT, 'test late audit rejection'); END;
  `);
  const before = mutationSnapshot(fixture);
  expect(() => batchMutation(true)).toThrow(/test late audit rejection/);
  expect(attemptedRows).toBeGreaterThanOrEqual(eventCount - 1);
  expect(mutationSnapshot(fixture)).toEqual(before);
});
