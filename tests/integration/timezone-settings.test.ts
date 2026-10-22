import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { createReadContext } from '../../src/core/context.js';
import type { CoreContext } from '../../src/core/database/types.js';
import { archiveProject, createProject } from '../../src/core/projects/commands.js';
import { createTask, archiveTask, updateTask } from '../../src/core/tasks/commands.js';
import { controlRecurrence } from '../../src/core/recurrence/control.js';
import {
  mutationSuccessEnvelopeSchema,
  successEnvelopeSchema,
  type MutationEnvelope,
} from '../../src/schema/envelopes.js';
import type { ReadScope } from '../../src/schema/scopes.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
import {
  occurrenceRows,
  outcomeSnapshot,
  parentRevision,
  assertOutcomeCommit,
} from '../fixtures/occurrence-outcomes.js';
const day = 86400000;
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Зона приложения', emoji: '🌅' }),
  );
  createProject(
    fixture.human,
    'beta',
    ordinaryInput(
      fixture,
      { slug: 'beta', name: 'Другая область', emoji: '🌳' },
      { projectSlug: 'beta' },
    ),
  );
});
afterEach(() => fixture?.close());
const settingsData = z.object({
  timezone: z.string(),
  revision: z.int().check(z.positive()),
  database_epoch: z.uuid(),
});
async function settingsApi() {
  const path = '../../src/core/projects/settings.js';
  const loaded: unknown = await import(path);
  const functions = z
    .object({
      updateSettings: z.custom<
        (context: CoreContext, slug: string, input: MutationEnvelope) => unknown
      >((value) => typeof value === 'function'),
      getSettings: z.custom<
        (context: ReturnType<typeof createReadContext>, scope: ReadScope) => unknown
      >((value) => typeof value === 'function'),
    })
    .parse(loaded);
  return {
    update(context: CoreContext, slug: string, input: MutationEnvelope) {
      return z
        .extend(mutationSuccessEnvelopeSchema, { data: settingsData })
        .parse(functions.updateSettings(context, slug, input));
    },
    get(scope: ReadScope) {
      return z
        .extend(successEnvelopeSchema, { data: settingsData })
        .parse(
          functions.getSettings(
            createReadContext({ connection: fixture.connection, now: fixture.clock.now }),
            scope,
          ),
        );
    },
  };
}
function settingsInput(timezone = 'Europe/Berlin', slug = 'alpha'): MutationEnvelope {
  return {
    ...ordinaryInput(fixture, { timezone }, { projectSlug: slug }),
    expected_settings_revision: 1,
  };
}
function childInput(id: string, payload: unknown, settings = 1, slug = 'alpha'): MutationEnvelope {
  return {
    ...ordinaryInput(fixture, jsonValueSchema.parse(payload), {
      projectSlug: slug,
      revision: parentRevision(fixture, id),
    }),
    expected_settings_revision: settings,
  };
}
function createRecurring(
  options: {
    elapsed?: boolean;
    first?: number;
    slug?: string;
  } = {},
) {
  const slug = options.slug ?? 'alpha';
  const result = createTask(fixture.human, slug, {
    ...ordinaryInput(
      fixture,
      {
        kind: 'recurring',
        title: 'Правило локального времени',
        recurrence: {
          first_deadline: new Date(options.first ?? fixture.clock.now() + day).toISOString(),
          schedule: options.elapsed
            ? { mode: 'after_completion', unit: 'hours', every: 2 }
            : { mode: 'calendar', pattern: 'days', every: 1, local_time: '13:00:00.123' },
          miss_policy: 'record_miss',
          confirmation_window_ms: 0,
        },
      },
      { projectSlug: slug },
    ),
    expected_settings_revision: 1,
  });
  return taskDetailSchema.parse(result.data).id;
}
function control(id: string, to: string, slug = 'alpha', settings = 1) {
  return controlRecurrence(
    fixture.human,
    slug,
    id,
    childInput(id, { to_status_id: to }, settings, slug),
  );
}
const generationSchema = z.object({
  id: z.uuid(),
  generation_number: z.number(),
  timezone: z.string(),
  schedule: z.string(),
  first_deadline: z.number(),
  successor_generation_id: z.nullable(z.string()),
});
function generations(id: string) {
  return z
    .array(generationSchema)
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT * FROM schedule_generations WHERE task_id=? ORDER BY generation_number')
        .all(id),
    );
}
function taskRow(id: string) {
  return fixture.connection.sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(id);
}
function storedOccurrences(id: string) {
  return z
    .array(z.looseObject(z.object({ id: z.uuid() }).shape))
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT * FROM occurrences WHERE task_id=? ORDER BY deadline,id')
        .all(id),
    );
}
function recurrenceStorage(id: string) {
  return ['schedule_generations', 'recurrence_state', 'recurrence_intervals', 'occurrences'].map(
    (table) =>
      fixture.connection.sqlite
        .prepare(`SELECT * FROM ${table} WHERE task_id=? ORDER BY rowid`)
        .all(id),
  );
}
function projectArchive(slug: string, ids: string[]) {
  const revision = z
    .number()
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT revision FROM projects WHERE slug=?')
        .pluck()
        .get(slug),
    );
  return archiveProject(fixture.human, slug, {
    ...ordinaryInput(
      fixture,
      {
        affected_tasks: ids.map((id) => ({
          task_id: id,
          expected_revision: parentRevision(fixture, id),
        })),
      },
      { projectSlug: slug, revision },
    ),
    expected_settings_revision: 1,
  });
}
it('settings reads are pure for scoped and aggregate callers with default shared timezone and epoch', async () => {
  const api = await settingsApi();
  const before = outcomeSnapshot(fixture);
  for (const scope of [{ all_projects: true }, { project_slug: 'alpha' }] as const)
    expect(api.get(scope).data).toEqual({
      timezone: 'Europe/Moscow',
      revision: 1,
      database_epoch: fixture.epoch,
    });
  expect(() => api.get({ project_slug: 'absent' })).toThrowError(
    expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it.each([
  'missing-settings',
  'stale-settings',
  'config',
  'epoch',
  'missing-project',
  'actor',
  'invalid-zone',
] as const)(
  'settings mutation rejects %s with no partial global, recurrence, audit or receipt writes',
  async (guard) => {
    const api = await settingsApi();
    const id = createRecurring();
    control(id, 'active');
    const input = settingsInput();
    let context = fixture.human;
    let slug = 'alpha';
    let code = 'VALIDATION_ERROR';
    if (guard === 'missing-settings') delete input.expected_settings_revision;
    if (guard === 'stale-settings') {
      input.expected_settings_revision = 2;
      code = 'CONFIG_CONFLICT';
    }
    if (guard === 'config') {
      input.expected_config_revision = 2;
      code = 'CONFIG_CONFLICT';
    }
    if (guard === 'epoch') {
      input.database_epoch = randomUUID();
      code = 'DATABASE_EPOCH_CONFLICT';
    }
    if (guard === 'missing-project') {
      slug = 'absent';
      code = 'PROJECT_NOT_FOUND';
    }
    if (guard === 'actor') context = fixture.agent('beta');
    if (guard === 'invalid-zone') input.payload = { timezone: 'Not/A_Zone' };
    const before = outcomeSnapshot(fixture);
    expect(() => api.update(context, slug, input)).toThrowError(expect.objectContaining({ code }));
    expect(outcomeSnapshot(fixture)).toEqual(before);
  },
);
it('same-zone update accepts an attributed audited revision change without unnecessary calendar versions', async () => {
  const api = await settingsApi();
  const id = createRecurring();
  const before = generations(id);
  const result = api.update(fixture.human, 'alpha', settingsInput('Europe/Moscow'));
  expect(result.data).toEqual({
    timezone: 'Europe/Moscow',
    revision: 2,
    database_epoch: fixture.epoch,
  });
  expect(result.meta.read_revision).toBeGreaterThan(1);
  expect(generations(id)).toEqual(before);
  assertOutcomeCommit(fixture, result);
});
it('global settings can attribute an archived project without impersonating another CLI scope', async () => {
  const api = await settingsApi();
  projectArchive('beta', []);
  const result = api.update(fixture.agent('beta'), 'beta', settingsInput('Europe/Berlin', 'beta'));
  expect(result.data.timezone).toBe('Europe/Berlin');
  expect(
    fixture.connection.sqlite
      .prepare('SELECT project_slug,actor FROM operation_receipts WHERE operation_id=?')
      .get(result.meta.operation_id),
  ).toEqual({ project_slug: 'beta', actor: 'ai-cli:beta' });
  const audit = fixture.connection.sqlite
    .prepare('SELECT project_slug,actor FROM audit_records WHERE operation_id=?')
    .all(result.meta.operation_id);
  expect(audit).toEqual(expect.arrayContaining([{ project_slug: 'beta', actor: 'ai-cli:beta' }]));
});
it('timezone update versions every calendar lifecycle across projects while leaving captured instants and elapsed work unchanged', async () => {
  const api = await settingsApi();
  const active = createRecurring();
  control(active, 'active');
  const draft = createRecurring();
  const paused = createRecurring();
  control(paused, 'active');
  control(paused, 'paused');
  const archived = createRecurring();
  archiveTask(fixture.human, 'alpha', archived, childInput(archived, {}));
  const projectArchived = createRecurring({ slug: 'beta' });
  projectArchive('beta', [projectArchived]);
  const elapsed = createRecurring({ elapsed: true });
  control(elapsed, 'active');
  const ordinary = taskDetailSchema.parse(
    createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, {
        kind: 'ordinary',
        title: 'Абсолютный срок',
        deadline: new Date(fixture.clock.now() + day).toISOString(),
      }),
    ).data,
  );
  const ids = [active, draft, paused, archived, projectArchived];
  const before = new Map(
    ids.map((id) => [
      id,
      {
        generations: generations(id),
        occurrences: storedOccurrences(id),
        revision: parentRevision(fixture, id),
      },
    ]),
  );
  const unchangedElapsed = [taskRow(elapsed), ...recurrenceStorage(elapsed)];
  const unchangedOrdinary = taskRow(ordinary.id);
  const result = api.update(fixture.human, 'alpha', settingsInput());
  expect(result.data.revision).toBe(2);
  for (const id of ids) {
    const original = before.get(id);
    if (!original) throw new Error('Expected initial calendar capture');
    const versions = generations(id);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toEqual({
      ...original.generations[0],
      successor_generation_id: versions[1]?.id,
    });
    expect(versions[1]).toMatchObject({
      generation_number: 2,
      timezone: 'Europe/Berlin',
      schedule: original.generations[0]?.schedule,
    });
    const oldIds = new Set(original.occurrences.map((row) => row.id));
    expect(storedOccurrences(id).filter((row) => oldIds.has(row.id))).toEqual(original.occurrences);
    expect(parentRevision(fixture, id)).toBe(original.revision + 1);
    if (id !== active) expect(storedOccurrences(id)).toEqual(original.occurrences);
  }
  expect([taskRow(elapsed), ...recurrenceStorage(elapsed)]).toEqual(unchangedElapsed);
  expect(taskRow(ordinary.id)).toEqual(unchangedOrdinary);
});
it('draft activation after timezone continuation cannot reseed its historical explicit first deadline', async () => {
  const api = await settingsApi();
  const first = fixture.clock.now() - 10 * day;
  const id = createRecurring({ first });
  api.update(fixture.human, 'alpha', settingsInput());
  expect(occurrenceRows(fixture, id)).toEqual([]);
  const changedAt = fixture.clock.now();
  control(id, 'active', 'alpha', 2);
  const stored = occurrenceRows(fixture, id);
  expect(stored).toHaveLength(1);
  expect(
    stored.every(
      (row) =>
        row.deadline > changedAt && row.deadline !== first && row.actual_completed_at === null,
    ),
  ).toBe(true);
});
it('global calendar versioning invalidates old parent entity tokens independently of the settings token', async () => {
  const api = await settingsApi();
  const id = createRecurring();
  const revision = parentRevision(fixture, id);
  api.update(fixture.human, 'alpha', settingsInput());
  const before = outcomeSnapshot(fixture);
  expect(() =>
    updateTask(
      fixture.human,
      'alpha',
      id,
      ordinaryInput(fixture, { title: 'Старое состояние родителя' }, { revision }),
    ),
  ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it('unreconciled old-zone arrears refuse the entire global change without publishing a partial calendar version', async () => {
  const api = await settingsApi();
  createRecurring();
  const owed = createRecurring({ first: fixture.clock.now() });
  control(owed, 'active');
  fixture.clock.advanceBy(200 * day);
  const before = outcomeSnapshot(fixture);
  expect(() => api.update(fixture.human, 'alpha', settingsInput())).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(before);
});
it('settings exact replay keeps original metadata and versions, while changed body, actor, attribution and old epoch conflict', async () => {
  const api = await settingsApi();
  createRecurring();
  const input = settingsInput();
  const result = api.update(fixture.human, 'alpha', input);
  const committed = outcomeSnapshot(fixture);
  fixture.clock.advanceBy(day);
  expect(api.update(fixture.human, 'alpha', input)).toEqual(result);
  expect(outcomeSnapshot(fixture)).toEqual(committed);
  for (const action of [
    () =>
      api.update(fixture.human, 'alpha', { ...input, payload: { timezone: 'America/New_York' } }),
    () => api.update(fixture.agent('alpha'), 'alpha', input),
    () => api.update(fixture.human, 'beta', input),
  ])
    expect(action).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  expect(outcomeSnapshot(fixture)).toEqual(committed);
  fixture.connection.sqlite
    .prepare('UPDATE application_state SET database_epoch=? WHERE id=1')
    .run(randomUUID());
  const restored = outcomeSnapshot(fixture);
  expect(() => api.update(fixture.human, 'alpha', input)).toThrowError(
    expect.objectContaining({ code: 'DATABASE_EPOCH_CONFLICT' }),
  );
  expect(outcomeSnapshot(fixture)).toEqual(restored);
});
it('a failed settings receipt rolls back every newly published calendar generation and injected settings revision', async () => {
  const api = await settingsApi();
  createRecurring();
  const input = settingsInput();
  const before = outcomeSnapshot(fixture);
  fixture.connection.sqlite
    .exec(`CREATE TRIGGER reject_settings_receipt BEFORE INSERT ON operation_receipts
    BEGIN SELECT RAISE(ABORT, 'injected settings receipt failure'); END`);
  expect(() => api.update(fixture.human, 'alpha', input)).toThrow();
  expect(outcomeSnapshot(fixture)).toEqual(before);
  fixture.connection.sqlite.exec('DROP TRIGGER reject_settings_receipt');
  const result = api.update(fixture.human, 'alpha', input);
  expect(result.data.revision).toBe(2);
  assertOutcomeCommit(fixture, result);
});
