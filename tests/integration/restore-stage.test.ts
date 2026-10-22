import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { createContext } from '../../src/core/context.js';
import { openDatabase } from '../../src/core/database/open.js';
import { createProject } from '../../src/core/projects/commands.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { readRawAuditRecords } from '../../src/core/recovery/history.js';
import { stageRestore, type StageInputs } from '../../src/core/recovery/stage.js';
import { describeSnapshot, finalizeSnapshot } from '../../src/core/recovery/snapshot.js';
import { RENDER_POLICY_VERSION, renderMarkdown } from '../../src/core/markdown/render.js';
import { formatTimestamp } from '../../src/core/time.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import {
  ordinaryInput,
  createOrdinaryFixture,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import { seedOutcomeParent, seedOccurrence } from '../fixtures/occurrence-outcomes.js';

let live: OrdinaryFixture;
let stage: ReturnType<typeof openDatabase> | undefined;
let lock: ReturnType<typeof acquireDatabaseLock> | undefined;
let input: StageInputs;
let taskIds: string[];
let occurrenceIds: string[];
const consent = {
  asserted: true as const,
  user_text: '  Восстановить весь снимок без утраты истории.  ',
};
function rawEvent(connection: ReturnType<typeof openDatabase>, epoch: string, suffix: string) {
  const id = randomUUID();
  connection.sqlite
    .prepare(
      `INSERT INTO audit_records
    (id,operation_id,project_slug,entity_type,entity_id,actor,origin,timestamp,action,changes,config_snapshot,confirmation,database_epoch)
    VALUES (?,?,?,'task',?,'human-web','web',?,'test.raw',?,?,?,?)`,
    )
    .run(
      id,
      randomUUID(),
      'alpha',
      id,
      live.clock.now(),
      `[\n  {"after":"${suffix}", "before":null, "field":"meaning"}\n]`,
      '{ "revision" : 1, "opaque" : "原文" }',
      '{ "user_text" : "  Точное согласие  ", "asserted" : true }',
      epoch,
    );
  return id;
}
function tableSnapshot(connection: ReturnType<typeof openDatabase>) {
  return [
    'application_state',
    'projects',
    'project_configs',
    'tasks',
    'occurrences',
    'schedule_generations',
    'recurrence_state',
    'recurrence_intervals',
    'project_emoji_reservations',
    'task_emoji_reservations',
    'audit_records',
    'operation_receipts',
    'pagination_secrets',
  ].map((table) => connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}
beforeEach(async () => {
  live = await createOrdinaryFixture();
  createProject(
    live.human,
    'alpha',
    ordinaryInput(live, { slug: 'alpha', name: 'alpha', emoji: '🔵' }),
  );
  taskIds = [];
  for (let index = 0; index < 17; index += 1) {
    const task = z.object({ id: z.uuid() }).parse(
      createTask(
        live.human,
        'alpha',
        ordinaryInput(live, {
          kind: 'ordinary',
          title: `Проверка ${index}`,
          description: `  <script>bad()</script>**Исходник ${index}**\n`,
        }),
      ).data,
    );
    taskIds.push(task.id);
  }
  const parent = seedOutcomeParent(live);
  occurrenceIds = [];
  for (let index = 0; index < 17; index += 1)
    occurrenceIds.push(
      seedOccurrence(live, parent, { deadline: parent.deadline + index, key: `stage:${index}` }).id,
    );
  const path = join(live.directory, 'private-stage.sqlite');
  await live.connection.sqlite.backup(path);
  finalizeSnapshot(path);
  lock = acquireDatabaseLock({ databasePath: path, mode: 'shared' });
  stage = openDatabase({ path, lock, now: live.clock.now });
  const stageContext = createContext({
    connection: stage,
    actor: 'human-web',
    now: live.clock.now,
  });
  createProject(
    stageContext,
    'snapshot-only',
    ordinaryInput(
      live,
      {
        slug: 'snapshot-only',
        name: 'Только выбранный снимок',
        emoji: '🟢',
      },
      { projectSlug: 'snapshot-only' },
    ),
  );
  const selectedPath = join(live.directory, 'selected-backup.sqlite');
  await stage.sqlite.backup(selectedPath);
  finalizeSnapshot(selectedPath);
  const backup = await describeSnapshot(selectedPath, {
    id: randomUUID(),
    createdAt: formatTimestamp(live.clock.now()),
  });
  createProject(
    live.human,
    'live-only',
    ordinaryInput(
      live,
      {
        slug: 'live-only',
        name: 'Только текущая база',
        emoji: '🟣',
      },
      { projectSlug: 'live-only' },
    ),
  );
  input = {
    live: live.connection,
    stage,
    backup: backup.info,
    context: createContext({ connection: stage, actor: 'ai-cli:alpha', now: live.clock.now }),
    operationId: randomUUID(),
    confirmation: consent,
    affectedProjects: ['alpha', 'live-only', 'snapshot-only'].map((project_slug) => ({
      project_slug,
      expected_revision: 1,
      expected_config_revision: 1,
    })),
    newEpoch: randomUUID(),
    recoverySnapshotId: randomUUID(),
    now: live.clock.now(),
  };
});
afterEach(async () => {
  try {
    stage?.close();
  } finally {
    try {
      if (lock) releaseDatabaseLock(lock);
    } finally {
      await live?.close();
    }
  }
  stage = undefined;
  lock = undefined;
});
it('preserves raw JSON history, snapshot receipts and immutable guards while recording each restore scope', () => {
  const current = input.stage;
  const liveRawId = rawEvent(live.connection, live.epoch, 'live');
  const snapshotRawId = rawEvent(current, live.epoch, 'snapshot');
  const original = [
    ...readRawAuditRecords(live.connection.sqlite),
    ...readRawAuditRecords(current.sqlite),
  ].filter((row) => row.id === liveRawId || row.id === snapshotRawId);
  const receiptRows = current.sqlite
    .prepare('SELECT * FROM operation_receipts ORDER BY operation_id')
    .all();
  const liveBefore = tableSnapshot(live.connection);
  const result = stageRestore(input);
  expect(result).toMatchObject({
    database_epoch: input.newEpoch,
    recovery_snapshot_id: input.recoverySnapshotId,
    affected_projects: ['alpha', 'live-only', 'snapshot-only'],
  });
  expect(result.audit_ids).toHaveLength(3);
  const restored = readRawAuditRecords(current.sqlite);
  expect(restored.filter((row) => row.id === liveRawId || row.id === snapshotRawId)).toEqual(
    original.sort((left, right) => left.id.localeCompare(right.id)),
  );
  expect(
    current.sqlite.prepare('SELECT * FROM operation_receipts ORDER BY operation_id').all(),
  ).toEqual(receiptRows);
  const events = restored.filter((row) => row.operation_id === input.operationId);
  expect(events.map((row) => row.project_slug).sort()).toEqual([
    'alpha',
    'live-only',
    'snapshot-only',
  ]);
  for (const event of events) {
    expect(event).toMatchObject({
      action: 'database.restore',
      entity_type: 'database',
      entity_id: input.newEpoch,
      database_epoch: input.newEpoch,
      actor: 'ai-cli:alpha',
      origin: 'cli',
    });
    expect(JSON.parse(event.confirmation ?? 'null')).toEqual(consent);
    expect(JSON.parse(event.config_snapshot ?? 'null')).toMatchObject({ revision: 1 });
  }
  expect(() =>
    current.sqlite
      .prepare('UPDATE audit_records SET action=? WHERE id=?')
      .run('changed', liveRawId),
  ).toThrow(/immutable/u);
  expect(() => current.sqlite.prepare('DELETE FROM operation_receipts').run()).toThrow(
    /immutable/u,
  );
  expect(() =>
    current.sqlite.prepare("UPDATE project_configs SET actor='human-web'").run(),
  ).toThrow(/immutable/u);
  expect(tableSnapshot(live.connection)).toEqual(liveBefore);
});
it('keeps live reservation contents, secret and nullable completion facts without changing restored entity revisions', () => {
  const current = input.stage;
  const originalTrigger = current.sqlite
    .prepare(
      "SELECT sql FROM sqlite_master WHERE name='project_emoji_reservations_immutable_update'",
    )
    .pluck()
    .get();
  if (typeof originalTrigger !== 'string') throw new Error('Missing production trigger');
  current.sqlite.exec('DROP TRIGGER project_emoji_reservations_immutable_update');
  current.sqlite
    .prepare(
      "UPDATE project_emoji_reservations SET first_reserved_at=first_reserved_at-100 WHERE emoji_key='🔵'",
    )
    .run();
  current.sqlite.exec(originalTrigger);
  const [first, second] = taskIds;
  if (!first || !second) throw new Error('Missing common tasks');
  current.sqlite
    .prepare('UPDATE tasks SET completion_recorded_at=? WHERE id=?')
    .run(live.clock.now() - 10, first);
  live.connection.sqlite
    .prepare('UPDATE tasks SET completion_recorded_at=? WHERE id=?')
    .run(live.clock.now() + 50, second);
  live.connection.sqlite
    .prepare('UPDATE pagination_secrets SET secret=? WHERE id=1')
    .run('b'.repeat(64));
  const versions = current.sqlite
    .prepare('SELECT id,revision,created_at,updated_at FROM tasks ORDER BY id')
    .all();
  const beforeRead = z
    .object({ read_revision: z.number() })
    .parse(
      live.connection.sqlite.prepare('SELECT read_revision FROM application_state').get(),
    ).read_revision;
  stageRestore(input);
  expect(
    current.sqlite.prepare('SELECT id,revision,created_at,updated_at FROM tasks ORDER BY id').all(),
  ).toEqual(versions);
  expect(
    current.sqlite.prepare('SELECT completion_recorded_at FROM tasks WHERE id=?').get(first),
  ).toEqual({ completion_recorded_at: null });
  expect(
    current.sqlite.prepare('SELECT completion_recorded_at FROM tasks WHERE id=?').get(second),
  ).toEqual({ completion_recorded_at: live.clock.now() + 50 });
  expect(current.sqlite.prepare('SELECT secret FROM pagination_secrets WHERE id=1').get()).toEqual({
    secret: 'b'.repeat(64),
  });
  expect(
    current.sqlite.prepare("SELECT * FROM project_emoji_reservations WHERE emoji_key='🔵'").get(),
  ).toEqual(
    live.connection.sqlite
      .prepare("SELECT * FROM project_emoji_reservations WHERE emoji_key='🔵'")
      .get(),
  );
  expect(
    current.sqlite
      .prepare("SELECT project_slug FROM project_emoji_reservations WHERE emoji_key='🟣'")
      .get(),
  ).toEqual({ project_slug: 'live-only' });
  expect(current.sqlite.prepare('SELECT slug FROM projects ORDER BY slug').all()).toEqual([
    { slug: 'alpha' },
    { slug: 'snapshot-only' },
  ]);
  expect(
    current.sqlite
      .prepare(
        "SELECT sql FROM sqlite_master WHERE name='project_emoji_reservations_immutable_update'",
      )
      .pluck()
      .get(),
  ).toBe(originalTrigger);
  expect(() =>
    current.sqlite.prepare('UPDATE project_emoji_reservations SET first_reserved_at=0').run(),
  ).toThrow(/immutable/u);
  expect(current.sqlite.prepare('SELECT read_revision FROM application_state').get()).toEqual({
    read_revision: beforeRead + 1,
  });
});
it('rebuilds every equal-policy unsafe cache across pages while all raw and frozen occurrence fields remain identical', () => {
  const current = input.stage;
  current.sqlite
    .prepare('UPDATE tasks SET description_html=?,render_policy_version=?')
    .run('<script>unsafe()</script>', RENDER_POLICY_VERSION);
  current.sqlite
    .prepare('UPDATE occurrences SET description_html_snapshot=?,render_policy_version=?')
    .run('<img src=x onerror=unsafe()>', RENDER_POLICY_VERSION);
  const frozen = current.sqlite
    .prepare(
      'SELECT id,description_snapshot,schedule_snapshot,deadline,expires_at,state,revision,created_at FROM occurrences ORDER BY id',
    )
    .all();
  stageRestore(input);
  expect(
    current.sqlite
      .prepare(
        'SELECT id,description_snapshot,schedule_snapshot,deadline,expires_at,state,revision,created_at FROM occurrences ORDER BY id',
      )
      .all(),
  ).toEqual(frozen);
  const rows = z
    .array(
      z.object({
        description: z.string(),
        description_html: z.string(),
        render_policy_version: z.number(),
      }),
    )
    .parse(
      current.sqlite
        .prepare('SELECT description,description_html,render_policy_version FROM tasks')
        .all(),
    );
  expect(rows.length).toBeGreaterThan(16);
  for (const row of rows)
    expect(row).toMatchObject({
      description_html: renderMarkdown(row.description),
      render_policy_version: RENDER_POLICY_VERSION,
    });
  const snapshots = z
    .array(z.object({ description_snapshot: z.string(), description_html_snapshot: z.string() }))
    .parse(
      current.sqlite
        .prepare('SELECT description_snapshot,description_html_snapshot FROM occurrences')
        .all(),
    );
  expect(snapshots).toHaveLength(occurrenceIds.length);
  for (const row of snapshots)
    expect(row.description_html_snapshot).toBe(renderMarkdown(row.description_snapshot));
});
it('a late staging failure rolls back epoch, imported history, reservations, caches and trigger changes together', () => {
  const current = input.stage;
  const late = current.sqlite
    .prepare('SELECT id FROM occurrences ORDER BY id DESC LIMIT 1')
    .pluck()
    .get();
  if (typeof late !== 'string') throw new Error('Missing late occurrence');
  current.sqlite
    .exec(`CREATE TRIGGER fail_late_render BEFORE UPDATE OF description_html_snapshot ON occurrences
    WHEN OLD.id='${late}' BEGIN SELECT RAISE(ABORT,'injected late stage failure'); END`);
  const before = tableSnapshot(current);
  const trigger = current.sqlite
    .prepare(
      "SELECT sql FROM sqlite_master WHERE name='project_emoji_reservations_immutable_update'",
    )
    .get();
  expect(() => stageRestore(input)).toThrow();
  expect(tableSnapshot(current)).toEqual(before);
  expect(
    current.sqlite
      .prepare(
        "SELECT sql FROM sqlite_master WHERE name='project_emoji_reservations_immutable_update'",
      )
      .get(),
  ).toEqual(trigger);
  expect(() =>
    current.sqlite.prepare('UPDATE project_emoji_reservations SET first_reserved_at=0').run(),
  ).toThrow(/immutable/u);
});
