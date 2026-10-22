import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createContext } from '../../src/core/context.js';
import { executeMutation } from '../../src/core/database/mutate.js';
import { projectConfigs, projects } from '../../src/schema/entities.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import {
  createMutationFixture,
  mutationSnapshot,
  type MutationFixture,
} from '../fixtures/mutation-seed.js';

type Command = Parameters<typeof executeMutation>[0];
let fixture: MutationFixture;

function command(overrides: Partial<Command> = {}) {
  return executeMutation({
    context: createContext({
      connection: fixture.connection,
      actor: 'human-web',
      now: fixture.clock.now,
    }),
    operation: 'test.project.priority',
    projectSlug: 'alpha',
    input: {
      operation_id: randomUUID(),
      database_epoch: fixture.epoch,
      expected_revision: 1,
      expected_config_revision: 1,
      expected_settings_revision: 1,
      payload: { priority: 5 },
    },
    guards: { entity: { type: 'project', id: fixture.ids.alpha }, settings: true },
    handler(transaction, now) {
      transaction
        .update(projects)
        .set({
          priority: 5,
          revision: sql`${projects.revision} + 1`,
          updatedAt: now,
        })
        .where(eq(projects.slug, 'alpha'))
        .run();
      return {
        data: { project_slug: 'alpha', priority: 5, revision: 2 },
        events: [
          {
            entity_type: 'project',
            entity_id: fixture.ids.alpha,
            action: 'priority_changed',
            changes: [{ field: 'priority', before: 0, after: 5 }],
            config_snapshot: { label: 'Original meaning' },
            confirmation: { asserted: true, user_text: 'Change priority' },
          },
        ],
      };
    },
    ...overrides,
  });
}

function envelope(operationId: string, payload = { priority: 5 }) {
  return {
    operation_id: operationId,
    database_epoch: fixture.epoch,
    expected_revision: 1,
    expected_config_revision: 1,
    expected_settings_revision: 1,
    payload,
  };
}

beforeEach(async () => {
  fixture = await createMutationFixture();
});

it('rejects an oversized direct engine request before state, audit or receipt writes', () => {
  const before = mutationSnapshot(fixture);
  expect(() =>
    command({ input: { ...envelope(randomUUID()), payload: { text: 'x'.repeat(1_048_576) } } }),
  ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(mutationSnapshot(fixture)).toEqual(before);
});
afterEach(async () => {
  await fixture?.close();
});

it('commits state, revisions, immutable semantic audit, and a durable receipt at the injected instant', () => {
  const before = mutationSnapshot(fixture);
  const operationId = randomUUID();
  const result = command({ input: envelope(operationId) });
  expect(result).toMatchObject({
    ok: true,
    data: { project_slug: 'alpha', priority: 5, revision: 2 },
    meta: {
      database_epoch: fixture.epoch,
      operation_id: operationId,
      now: new Date(fixture.clock.now()).toISOString(),
      timezone: 'Europe/Moscow',
    },
  });
  expect(result.meta.audit_ids).toHaveLength(1);
  expect(
    fixture.connection.sqlite
      .prepare('SELECT priority, revision, updated_at FROM projects WHERE slug = ?')
      .get('alpha'),
  ).toEqual({ priority: 5, revision: 2, updated_at: fixture.clock.now() });
  const after = mutationSnapshot(fixture);
  expect(after.audits).toHaveLength(1);
  expect(after.receipts).toHaveLength(1);
  expect(after.audits[0]).toMatchObject({
    id: result.meta.audit_ids[0],
    operation_id: operationId,
    project_slug: 'alpha',
    actor: 'human-web',
    timestamp: fixture.clock.now(),
    database_epoch: fixture.epoch,
    entity_type: 'project',
    entity_id: fixture.ids.alpha,
    action: 'priority_changed',
  });
  expect(after.receipts[0]).toMatchObject({
    operation_id: operationId,
    database_epoch: fixture.epoch,
    actor: 'human-web',
    project_slug: 'alpha',
    operation: 'test.project.priority',
    committed_at: fixture.clock.now(),
  });
  for (const [column, expected] of [
    ['changes', [{ field: 'priority', before: 0, after: 5 }]],
    ['config_snapshot', { label: 'Original meaning' }],
    ['confirmation', { asserted: true, user_text: 'Change priority' }],
  ] as const) {
    const value = fixture.connection.sqlite
      .prepare(`SELECT ${column} FROM audit_records`)
      .pluck()
      .get();
    expect(JSON.parse(String(value))).toEqual(expected);
  }
  expect(
    JSON.parse(
      String(
        fixture.connection.sqlite.prepare('SELECT result FROM operation_receipts').pluck().get(),
      ),
    ),
  ).toEqual(result);
  expect(after.state).not.toEqual(before.state);
  expect(
    fixture.connection.sqlite
      .prepare('SELECT read_revision FROM application_state WHERE id = 1')
      .get(),
  ).toMatchObject({ read_revision: 2 });
  const savedAudit = after.audits;
  fixture.connection.sqlite
    .prepare("UPDATE projects SET config_revision = 2 WHERE slug = 'alpha'")
    .run();
  expect(mutationSnapshot(fixture).audits).toEqual(savedAudit);
});

it('returns the original envelope before checking now-stale entity/config/settings revisions', () => {
  const input = envelope(randomUUID());
  const first = command({ input });
  fixture.clock.advanceBy(60_000);
  fixture.connection.sqlite
    .prepare("UPDATE projects SET config_revision = 2 WHERE slug = 'alpha'")
    .run();
  fixture.connection.sqlite
    .prepare('UPDATE application_state SET revision = revision + 1 WHERE id = 1')
    .run();
  const beforeReplay = mutationSnapshot(fixture);
  expect(
    command({
      input,
      handler() {
        throw new Error('Replay must not invoke the handler');
      },
    }),
  ).toEqual(first);
  expect(mutationSnapshot(fixture)).toEqual(beforeReplay);
});

it('checks the current epoch before consulting an otherwise exact successful receipt', () => {
  const input = envelope(randomUUID());
  command({ input });
  fixture.connection.sqlite
    .prepare('UPDATE application_state SET database_epoch = ? WHERE id = 1')
    .run(randomUUID());
  const before = mutationSnapshot(fixture);
  expect(() => command({ input })).toThrowError(
    expect.objectContaining({ code: 'DATABASE_EPOCH_CONFLICT' }),
  );
  expect(mutationSnapshot(fixture)).toEqual(before);
});

it('canonicalizes nested JSON object keys while preserving the exact original result and receipt', () => {
  const operationId = randomUUID();
  const firstInput = {
    ...envelope(operationId),
    payload: { priority: 5, nested: { a: 1, b: [1, { x: 2, y: 3 }] } },
  };
  const first = command({ input: firstInput });
  const before = mutationSnapshot(fixture);
  const reordered = {
    payload: { nested: { b: [1, { y: 3, x: 2 }], a: 1 }, priority: 5 },
    expected_settings_revision: 1,
    expected_config_revision: 1,
    expected_revision: 1,
    database_epoch: fixture.epoch,
    operation_id: operationId,
  };
  expect(command({ input: reordered })).toEqual(first);
  expect(mutationSnapshot(fixture)).toEqual(before);
});

it.each([
  'actor',
  'scope',
  'operation',
  'body',
  'preconditions',
  'array-order',
  'target',
  'own-prototype-key',
])('rejects reuse of an operation ID after changing %s without adding writes', (change) => {
  const input = { ...envelope(randomUUID()), payload: { priority: 5, values: [1, 2] } };
  command({ input });
  const before = mutationSnapshot(fixture);
  const changed: Partial<Command> = { input };
  if (change === 'actor')
    changed.context = createContext({
      connection: fixture.connection,
      actor: 'ai-cli:alpha',
      now: fixture.clock.now,
    });
  if (change === 'scope') changed.projectSlug = 'beta';
  if (change === 'operation') changed.operation = 'test.project.other';
  if (change === 'body') changed.input = { ...input, payload: { priority: 6, values: [1, 2] } };
  if (change === 'preconditions') changed.input = { ...input, expected_revision: 2 };
  if (change === 'array-order')
    changed.input = { ...input, payload: { priority: 5, values: [2, 1] } };
  if (change === 'own-prototype-key')
    changed.input = {
      ...input,
      payload: jsonValueSchema.parse(
        JSON.parse('{"priority":5,"values":[1,2],"__proto__":{"changed":true}}'),
      ),
    };
  if (change === 'target')
    changed.guards = { entity: { type: 'project', id: fixture.ids.beta }, settings: true };
  expect(() => command(changed)).toThrowError(
    expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
  );
  expect(mutationSnapshot(fixture)).toEqual(before);
});

it.each([
  ['entity', 'REVISION_CONFLICT'],
  ['config', 'CONFIG_CONFLICT'],
  ['settings', 'CONFIG_CONFLICT'],
])('rejects a stale %s revision before invoking the handler', (guard, code) => {
  const input = envelope(randomUUID());
  if (guard === 'entity') input.expected_revision = 99;
  if (guard === 'config') input.expected_config_revision = 99;
  if (guard === 'settings') input.expected_settings_revision = 99;
  const before = mutationSnapshot(fixture);
  expect(() =>
    command({
      input,
      handler() {
        throw new Error('Stale guard reached handler');
      },
    }),
  ).toThrowError(expect.objectContaining({ code }));
  expect(mutationSnapshot(fixture)).toEqual(before);
});

it('rejects cross-project task ownership before any state, audit, receipt, or revision changes', () => {
  const before = mutationSnapshot(fixture);
  expect(() =>
    command({
      guards: { entity: { type: 'task', id: fixture.ids.betaTask } },
      handler() {
        throw new Error('Wrong-project task reached handler');
      },
    }),
  ).toThrowError(expect.objectContaining({ code: 'PROJECT_MISMATCH' }));
  expect(mutationSnapshot(fixture)).toEqual(before);
});

it('requires an explicit existing project scope and rejects nonexistent targets', () => {
  const before = mutationSnapshot(fixture);
  expect(() => command({ projectSlug: '' })).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(() => command({ projectSlug: 'absent' })).toThrowError(
    expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }),
  );
  expect(() => command({ guards: { entity: { type: 'task', id: randomUUID() } } })).toThrowError(
    expect.objectContaining({ code: 'TASK_NOT_FOUND' }),
  );
  expect(mutationSnapshot(fixture)).toEqual(before);
});

it.each(['expected_revision', 'expected_config_revision', 'expected_settings_revision'] as const)(
  'rejects missing required %s before invoking the handler',
  (field) => {
    const input: Command['input'] = envelope(randomUUID());
    delete input[field];
    const before = mutationSnapshot(fixture);
    expect(() =>
      command({
        input,
        handler() {
          throw new Error('Missing guard reached handler');
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(mutationSnapshot(fixture)).toEqual(before);
  },
);

it('rolls back state and reservations when a handler throws after its writes', () => {
  const before = mutationSnapshot(fixture);
  expect(() =>
    command({
      handler(transaction, now) {
        transaction
          .update(projects)
          .set({ priority: 77, revision: 2, updatedAt: now })
          .where(eq(projects.slug, 'alpha'))
          .run();
        fixture.connection.sqlite
          .prepare(
            `INSERT INTO project_emoji_reservations
          (emoji_key, project_slug, first_reserved_at, emoji) VALUES ('🟣', 'alpha', ?, '🟣')`,
          )
          .run(now);
        throw new Error('Injected failure after state and reservation writes');
      },
    }),
  ).toThrowError('Injected failure after state and reservation writes');
  expect(mutationSnapshot(fixture)).toEqual(before);
});

it.each(['audit_records', 'operation_receipts'])(
  'rolls back state and earlier audit work when %s insertion fails',
  (table) => {
    fixture.connection.sqlite.exec(`CREATE TRIGGER reject_test_insert BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END`);
    const before = mutationSnapshot(fixture);
    expect(() => command()).toThrow();
    expect(mutationSnapshot(fixture)).toEqual(before);
    fixture.connection.sqlite.exec('DROP TRIGGER reject_test_insert');
    // A rejected operation leaves no durable success; a fresh valid write can still commit.
    expect(command()).toMatchObject({ ok: true });
    expect(mutationSnapshot(fixture).audits).toHaveLength(1);
    expect(mutationSnapshot(fixture).receipts).toHaveLength(1);
  },
);

it('records recurrence-worker attribution and uses the injected command clock', () => {
  fixture.clock.advanceBy(123_456);
  const result = command({
    context: createContext({
      connection: fixture.connection,
      actor: 'ai-cli:alpha',
      origin: 'recurrence-worker',
      now: fixture.clock.now,
    }),
  });
  expect(result.meta.now).toBe(new Date(fixture.clock.now()).toISOString());
  expect(mutationSnapshot(fixture).audits[0]).toMatchObject({
    actor: 'ai-cli:alpha',
    origin: 'recurrence-worker',
    timestamp: fixture.clock.now(),
  });
});

it('rejects a fresh CLI actor whose attribution differs from the explicit project scope', () => {
  const before = mutationSnapshot(fixture);
  expect(() =>
    command({
      context: createContext({ connection: fixture.connection, actor: 'ai-cli:beta' }),
      handler() {
        throw new Error('Mismatched actor reached the handler');
      },
    }),
  ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(mutationSnapshot(fixture)).toEqual(before);
});

it('includes origin in replay identity even when actor, scope, body, and target match', () => {
  const input = envelope(randomUUID());
  command({
    input,
    context: createContext({ connection: fixture.connection, actor: 'ai-cli:alpha' }),
  });
  const before = mutationSnapshot(fixture);
  expect(() =>
    command({
      input,
      context: createContext({
        connection: fixture.connection,
        actor: 'ai-cli:alpha',
        origin: 'recurrence-worker',
      }),
    }),
  ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  expect(mutationSnapshot(fixture)).toEqual(before);
});

it('commits creation in a new explicit scope without nonexistent entity/config revision tokens', () => {
  const id = randomUUID();
  const input = { operation_id: randomUUID(), database_epoch: fixture.epoch, payload: {} };
  const options: Command = {
    context: createContext({ connection: fixture.connection, actor: 'ai-cli:gamma' }),
    operation: 'test.project.create',
    projectSlug: 'gamma',
    input,
    guards: { projectRequired: false, config: false },
    handler(transaction, now) {
      transaction
        .insert(projects)
        .values({
          id,
          slug: 'gamma',
          name: 'Gamma',
          emoji: '🟣',
          emojiKey: '🟣',
          createdAt: now,
          updatedAt: now,
        })
        .run();
      // Configuration semantics belong to story tests; the kernel preserves these
      // real storage snapshots atomically with the new project and its receipt.
      transaction
        .insert(projectConfigs)
        .values({
          projectSlug: 'gamma',
          revision: 1,
          priorityModel: { type: 'classic' },
          ordinaryWorkflow: {},
          recurringWorkflow: {},
          semanticSnapshot: {},
          effectiveAt: now,
          actor: 'ai-cli:gamma',
        })
        .run();
      return {
        data: { id, slug: 'gamma' },
        events: [
          {
            entity_type: 'project',
            entity_id: id,
            action: 'created',
            changes: [{ field: 'slug', before: null, after: 'gamma' }],
          },
        ],
      };
    },
  };
  const result = executeMutation(options);
  expect(result.data).toEqual({ id, slug: 'gamma' });
  expect(
    fixture.connection.sqlite
      .prepare("SELECT revision FROM project_configs WHERE project_slug='gamma'")
      .get(),
  ).toEqual({ revision: 1 });
  const beforeReplay = mutationSnapshot(fixture);
  expect(executeMutation(options)).toEqual(result);
  expect(mutationSnapshot(fixture)).toEqual(beforeReplay);
});

it('rolls back an internally inconsistent new-project guard configuration', () => {
  const before = mutationSnapshot(fixture);
  expect(() =>
    command({
      guards: { projectRequired: false },
      handler() {
        throw new Error('Invalid guards reached the handler');
      },
    }),
  ).toThrowError(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
  expect(mutationSnapshot(fixture)).toEqual(before);
});
