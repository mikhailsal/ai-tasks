import { afterEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { archiveProject, restoreProject } from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { migrateConfiguration } from '../../src/core/projects/configuration.js';
import { archiveTask, createTask } from '../../src/core/tasks/commands.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { mutationSuccessEnvelopeSchema } from '../../src/schema/envelopes.js';
import { invokeOrdinaryCli, type OrdinaryFixture } from '../fixtures/ordinary-work.js';
import {
  allChildren,
  cancelFuture,
  control,
  createRecurring,
  day,
  json,
  lifecycleFixture,
  occurrenceRows,
  parentRow,
  projectEnvelope,
  recurrenceApi,
  recurrenceEnvelope,
  recurrenceInput,
  recurrenceSnapshot,
  settingsRevision,
  tick,
} from '../fixtures/recurrence-lifecycle.js';
let fixture: OrdinaryFixture;
afterEach(async () => {
  await fixture?.close();
});
it('compiled recurring creation accepts the explicit policy/window/anchor after a valid metadata read [US5 behavioral RED]', async () => {
  fixture = await lifecycleFixture();
  const meta = invokeOrdinaryCli(fixture, ['meta', '--all-projects', '--json'], {});
  expect(meta.status, meta.stderr).toBe(0);
  const metadata = metaEnvelopeSchema.parse(JSON.parse(meta.stdout));
  const result = invokeOrdinaryCli(
    fixture,
    ['task', 'create', '--project', 'alpha', '--json', '--input', '-'],
    {
      operation_id: recurrenceEnvelope(fixture, {}).operation_id,
      database_epoch: fixture.epoch,
      expected_config_revision: 1,
      expected_settings_revision: metadata.data.settings_revision,
      kind: 'recurring',
      title: 'Поддерживать регулярную работу',
      recurrence: recurrenceInput(fixture.clock.now()),
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  expect(mutationSuccessEnvelopeSchema.parse(JSON.parse(result.stdout)).data).toMatchObject({
    kind: 'recurring',
    status_id: 'draft',
  });
});
it('materializes pre-pause arrears after downtime but never invents obligations for paused periods', async () => {
  fixture = await lifecycleFixture();
  const first = fixture.clock.now();
  const id = createRecurring(fixture, first);
  await control(fixture, id, 'active');
  fixture.clock.advanceBy(5 * day + 3600000);
  const pausedAt = fixture.clock.now();
  await control(fixture, id, 'paused');
  const precreated = occurrenceRows(fixture, id)
    .filter((row) => row.deadline >= pausedAt)
    .map((row) => row.deadline);
  fixture.clock.advanceBy(30 * day);
  for (let pass = 0; pass < 10; pass += 1) await tick(fixture, [id]);
  const deadlines = occurrenceRows(fixture, id).map((row) => row.deadline);
  expect(deadlines).toEqual(
    [
      ...new Set([...Array.from({ length: 6 }, (_, index) => first + index * day), ...precreated]),
    ].sort((a, b) => a - b),
  );
  expect(occurrenceRows(fixture, id).every((row) => row.state === 'missed')).toBe(true);
  expect(parentRow(fixture, id).status_id).toBe('paused');
});
it('retains a precreated future window while paused and still expires it by its captured conditions', async () => {
  fixture = await lifecycleFixture();
  const first = fixture.clock.now() + day;
  const id = createRecurring(fixture, first, { policy: 'carry_forward', window: 5 * day });
  await control(fixture, id, 'active');
  const original = occurrenceRows(fixture, id);
  expect(original).toHaveLength(1);
  await control(fixture, id, 'paused');
  fixture.clock.set(first + 2 * day);
  await tick(fixture, [id]);
  expect(occurrenceRows(fixture, id)).toEqual(original);
  fixture.clock.set(first + 5 * day + 1);
  await tick(fixture, [id]);
  expect(occurrenceRows(fixture, id)).toEqual([
    expect.objectContaining({
      id: original[0]?.id,
      deadline: first,
      state: 'debt',
      missed_at: expect.any(Number),
    }),
  ]);
  const api = await recurrenceApi();
  const debt = occurrenceRows(fixture, id)[0];
  if (!debt) throw new Error('Expected the retained obligation');
  const before = recurrenceSnapshot(fixture);
  expect(() =>
    api.cancelOccurrences(
      fixture.human,
      'alpha',
      id,
      recurrenceEnvelope(
        fixture,
        {
          occurrences: [{ id: debt.id, expected_revision: debt.revision }],
          reason: 'Нельзя простить долг',
        },
        id,
      ),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(recurrenceSnapshot(fixture)).toEqual(before);
});
it('calendar resume selects the next future anchor and skips all paused dates', async () => {
  fixture = await lifecycleFixture();
  const first = fixture.clock.now();
  const id = createRecurring(fixture, first);
  await control(fixture, id, 'active');
  await tick(fixture, [id]);
  fixture.clock.advanceBy(3600000);
  await control(fixture, id, 'paused');
  await cancelFuture(fixture, id);
  await tick(fixture, [id]);
  const historical = occurrenceRows(fixture, id);
  fixture.clock.set(first + 10 * day + 3600000);
  await control(fixture, id, 'active');
  await tick(fixture, [id]);
  const added = occurrenceRows(fixture, id).filter(
    (row) => !historical.some((old) => old.id === row.id),
  );
  expect(added.map((row) => row.deadline)).toEqual([first + 11 * day]);
  expect(
    occurrenceRows(fixture, id).filter((row) => historical.some((old) => old.id === row.id)),
  ).toEqual(historical);
});
it.each([false, true])(
  'completion-relative resume handles an elapsed candidate=%j without paused-period debt',
  async (elapsed) => {
    fixture = await lifecycleFixture();
    const first = fixture.clock.now();
    const id = createRecurring(fixture, first, { elapsed: true });
    await control(fixture, id, 'active');
    fixture.clock.advanceBy(3600000);
    await control(fixture, id, 'paused');
    const row = occurrenceRows(fixture, id)[0];
    if (!row) throw new Error('Missing first occurrence');
    const api = await recurrenceApi();
    const actual = fixture.clock.now();
    api.completeOccurrences(
      fixture.human,
      'alpha',
      id,
      recurrenceEnvelope(
        fixture,
        {
          occurrences: [
            {
              id: row.id,
              expected_revision: row.revision,
              actual_completed_at: new Date(actual).toISOString(),
            },
          ],
        },
        id,
      ),
    );
    expect(occurrenceRows(fixture, id)).toHaveLength(1);
    fixture.clock.set(actual + (elapsed ? 3 * day : 3600000));
    const history = occurrenceRows(fixture, id);
    if (elapsed) {
      const before = recurrenceSnapshot(fixture);
      await expect(control(fixture, id, 'active')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(recurrenceSnapshot(fixture)).toEqual(before);
      await control(fixture, id, 'active', {
        first_deadline: new Date(fixture.clock.now() + day).toISOString(),
      });
    } else await control(fixture, id, 'active');
    const rows = occurrenceRows(fixture, id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(history[0]);
    expect(rows[1]).toMatchObject({
      state: 'pending',
      deadline: elapsed ? fixture.clock.now() + day : actual + day,
      actual_completed_at: null,
    });
    if (elapsed) expect(rows[1]?.generation_id).not.toBe(rows[0]?.generation_id);
  },
);
it('project archive validates every child and cannot forgive owed or precreated pending work', async () => {
  fixture = await lifecycleFixture();
  const first = fixture.clock.now();
  const id = createRecurring(fixture, first, { policy: 'carry_forward' });
  await control(fixture, id, 'active');
  fixture.clock.advanceBy(5 * day);
  const before = recurrenceSnapshot(fixture);
  expect(() =>
    archiveProject(
      fixture.human,
      'alpha',
      projectEnvelope(fixture, { affected_tasks: allChildren(fixture) }),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(recurrenceSnapshot(fixture)).toEqual(before);
  await control(fixture, id, 'paused');
  await tick(fixture, [id]);
  const debts = occurrenceRows(fixture, id).filter((row) => row.state === 'debt');
  expect(debts.length).toBeGreaterThan(1);
  const afterCatchup = recurrenceSnapshot(fixture);
  expect(() =>
    archiveProject(
      fixture.human,
      'alpha',
      projectEnvelope(fixture, { affected_tasks: allChildren(fixture) }),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(recurrenceSnapshot(fixture)).toEqual(afterCatchup);
  expect(occurrenceRows(fixture, id).filter((row) => row.state === 'debt')).toEqual(debts);
});
it('project archive/restore validates complete revisions and only restores formerly active recurring children to paused', async () => {
  fixture = await lifecycleFixture();
  const adminConfig = createDefaultProjectConfig();
  adminConfig.recurring_workflow.statuses.push({
    id: 'holding',
    label: 'Ожидание',
    category: 'paused',
  });
  adminConfig.recurring_workflow.restore_status_id = 'holding';
  adminConfig.recurring_workflow.transitions = adminConfig.recurring_workflow.transitions.map(
    (edge) =>
      edge.from === 'archived' && edge.to === 'paused'
        ? { from: 'archived', to: 'holding', requires_confirmation: true }
        : edge,
  );
  migrateConfiguration(
    fixture.human,
    'alpha',
    recurrenceEnvelope(
      fixture,
      json({
        config: adminConfig,
        status_mappings: [],
        priority_mappings: [],
        affected_tasks: [],
      }),
      undefined,
      { expected_revision: 1 },
    ),
  );
  const now = fixture.clock.now();
  const active = createRecurring(fixture, now - day, { elapsed: true });
  await control(fixture, active, 'active');
  await tick(fixture, [active]);
  const paused = createRecurring(fixture, now - day, { elapsed: true });
  await control(fixture, paused, 'active');
  await control(fixture, paused, 'paused');
  await tick(fixture, [paused]);
  const draft = createRecurring(fixture, now + day);
  const archived = createRecurring(fixture, now + day);
  archiveTask(fixture.human, 'alpha', archived, recurrenceEnvelope(fixture, {}, archived));
  const ordinary = z
    .object({ id: z.string() })
    .parse(
      createTask(
        fixture.human,
        'alpha',
        recurrenceEnvelope(fixture, { kind: 'ordinary', title: 'Обычная работа' }),
      ).data,
    ).id;
  const rows = [active, paused, draft, archived, ordinary].map((id) => parentRow(fixture, id));
  const missing = allChildren(fixture).slice(1);
  const before = recurrenceSnapshot(fixture);
  expect(() =>
    archiveProject(fixture.human, 'alpha', projectEnvelope(fixture, { affected_tasks: missing })),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(recurrenceSnapshot(fixture)).toEqual(before);
  archiveProject(
    fixture.human,
    'alpha',
    projectEnvelope(fixture, { affected_tasks: allChildren(fixture) }),
  );
  expect(rows.map((row) => parentRow(fixture, row.id))).toEqual(rows);
  const archivedSnapshot = recurrenceSnapshot(fixture);
  const stale = allChildren(fixture).map((row) => ({
    ...row,
    expected_revision: row.task_id === active ? row.expected_revision - 1 : row.expected_revision,
  }));
  expect(() =>
    restoreProject(fixture.human, 'alpha', projectEnvelope(fixture, { affected_tasks: stale })),
  ).toThrow(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  expect(recurrenceSnapshot(fixture)).toEqual(archivedSnapshot);
  const result = restoreProject(
    fixture.human,
    'alpha',
    projectEnvelope(fixture, { affected_tasks: allChildren(fixture) }),
  );
  expect(parentRow(fixture, active)).toMatchObject({
    status_id: 'holding',
    revision: rows[0] ? rows[0].revision + 1 : -1,
  });
  expect(rows.slice(1).map((row) => parentRow(fixture, row.id))).toEqual(rows.slice(1));
  expect(
    fixture.connection.sqlite
      .prepare("SELECT entity_id FROM audit_records WHERE operation_id=? AND entity_type='task'")
      .all(result.meta.operation_id),
  ).toEqual([{ entity_id: active }]);
  const restored = occurrenceRows(fixture, active);
  fixture.clock.advanceBy(10 * day);
  await tick(fixture, [active, paused]);
  expect(occurrenceRows(fixture, active)).toEqual(restored);
});
it('retirement-producing configuration category mappings cannot erase pending/debt or owed anchors', async () => {
  fixture = await lifecycleFixture();
  const id = createRecurring(fixture, fixture.clock.now() - 4 * day, { policy: 'carry_forward' });
  await control(fixture, id, 'active');
  const config = createDefaultProjectConfig();
  const retiring = {
    ...config,
    recurring_workflow: {
      ...config.recurring_workflow,
      statuses: config.recurring_workflow.statuses.filter((status) => status.id !== 'active'),
      transitions: config.recurring_workflow.transitions.filter(
        (edge) => edge.from !== 'active' && edge.to !== 'active',
      ),
    },
  };
  const before = recurrenceSnapshot(fixture);
  expect(() =>
    migrateConfiguration(
      fixture.human,
      'alpha',
      recurrenceEnvelope(
        fixture,
        json({
          config: retiring,
          status_mappings: [
            { kind: 'recurring', from_status_id: 'active', to_status_id: 'archived' },
          ],
          priority_mappings: [],
          affected_tasks: [{ task_id: id, expected_revision: parentRow(fixture, id).revision }],
        }),
        undefined,
        { expected_revision: 1 },
      ),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(recurrenceSnapshot(fixture)).toEqual(before);
});
it('timezone changes preserve existing instants and stale settings tokens reject every schedule-dependent operation atomically', async () => {
  fixture = await lifecycleFixture();
  const id = createRecurring(fixture, fixture.clock.now(), { window: 10 * day });
  await control(fixture, id, 'active');
  await tick(fixture, [id]);
  const frozen = occurrenceRows(fixture, id);
  const oldSettings = settingsRevision(fixture);
  const api = await recurrenceApi();
  api.updateSettings(
    fixture.human,
    'alpha',
    recurrenceEnvelope(fixture, { timezone: 'America/New_York' }),
  );
  expect(settingsRevision(fixture)).toBe(oldSettings + 1);
  const originalIds = new Set(frozen.map((row) => row.id));
  expect(occurrenceRows(fixture, id).filter((row) => originalIds.has(row.id))).toEqual(frozen);
  const selectedRow = frozen[0];
  if (!selectedRow) throw new Error('Expected an existing obligation');
  const stale = (payload: Parameters<typeof recurrenceEnvelope>[1], taskId?: string) =>
    recurrenceEnvelope(fixture, payload, taskId, { expected_settings_revision: oldSettings });
  const commands = [
    () =>
      createTask(
        fixture.human,
        'alpha',
        stale({
          kind: 'recurring',
          title: 'Устаревшая зона',
          recurrence: recurrenceInput(fixture.clock.now() + day),
        }),
      ),
    () =>
      api.configureRecurrence(
        fixture.human,
        'alpha',
        id,
        stale(recurrenceInput(fixture.clock.now() + 2 * day), id),
      ),
    () => api.controlRecurrence(fixture.human, 'alpha', id, stale({ to_status_id: 'paused' }, id)),
    () =>
      api.tickRecurrence(
        fixture.human,
        'alpha',
        stale({ tasks: [{ task_id: id, expected_revision: parentRow(fixture, id).revision }] }),
      ),
    () =>
      api.completeOccurrences(
        fixture.human,
        'alpha',
        id,
        stale(
          { occurrences: [{ id: selectedRow.id, expected_revision: selectedRow.revision }] },
          id,
        ),
      ),
  ];
  for (const command of commands) {
    const before = recurrenceSnapshot(fixture);
    expect(command).toThrow(
      expect.objectContaining({
        code: 'CONFIG_CONFLICT',
        details: expect.objectContaining({ scope: 'settings' }),
      }),
    );
    expect(recurrenceSnapshot(fixture)).toEqual(before);
  }
});
it('a future precreated row blocks project retirement until explicitly cancelled while paused', async () => {
  fixture = await lifecycleFixture();
  const id = createRecurring(fixture, fixture.clock.now() + day);
  await control(fixture, id, 'active');
  const before = recurrenceSnapshot(fixture);
  expect(() =>
    archiveProject(
      fixture.human,
      'alpha',
      projectEnvelope(fixture, { affected_tasks: allChildren(fixture) }),
    ),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(recurrenceSnapshot(fixture)).toEqual(before);
  await control(fixture, id, 'paused');
  await cancelFuture(fixture, id);
  const cancelled = occurrenceRows(fixture, id);
  expect(cancelled).toHaveLength(1);
  expect(cancelled[0]?.state).toBe('cancelled');
  archiveProject(
    fixture.human,
    'alpha',
    projectEnvelope(fixture, { affected_tasks: allChildren(fixture) }),
  );
  expect(occurrenceRows(fixture, id)).toEqual(cancelled);
});
