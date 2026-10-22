import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';
import { errorDefinitions, type ErrorCode } from '../../src/schema/errors.js';
import {
  createRecurrenceHarness,
  futureRecurrence,
  recurrenceSuccess,
  type RecurrenceHarness,
  type RecurrenceRequest,
} from '../fixtures/recurrence-contract.js';
import type { Transport } from '../fixtures/us2-contract.js';
let harness: RecurrenceHarness;
beforeEach(async () => {
  harness = await createRecurrenceHarness({ restoreConfirmation: true });
});
afterEach(() => harness?.close());
function failure(
  result: Awaited<ReturnType<RecurrenceHarness['request']>>,
  transport: Transport,
  code: ErrorCode,
) {
  const expected = errorDefinitions[code];
  expect(result.status).toBe(transport === 'cli' ? expected.cliExit : expected.httpStatus);
  expect(errorEnvelopeSchema.parse(result.envelope).error.code).toBe(code);
}
function outcomeInput(
  id: string,
  action: 'complete' | 'cancel',
  selected: {
    id: string;
    revision: number;
  }[],
): RecurrenceRequest {
  return {
    command: ['occurrence', action, id],
    path: `/projects/alpha/tasks/${id}/occurrences/${action}`,
    scope: 'alpha',
    method: 'POST',
    mutation: true,
    revision: harness.task(id).revision,
    configRevision: 1,
    ...(action === 'complete' ? { settingsRevision: 1 } : {}),
    body: {
      occurrences: selected.map((item) => ({ id: item.id, expected_revision: item.revision })),
      ...(action === 'cancel' ? { reason: 'Период больше не нужен' } : {}),
    },
  };
}
it('compiled recurring creation succeeds after metadata proves the real executable and epoch [US5 behavioral RED]', async () => {
  const control = recurrenceSuccess(
    await harness.request('cli', {
      command: ['meta'],
      path: '/meta?all_projects=true',
    }),
    'cli',
  );
  expect(control.meta.database_epoch).toBe(harness.epoch);
  const result = await harness.request('cli', {
    command: ['task', 'create'],
    path: '/projects/alpha/tasks',
    scope: 'alpha',
    method: 'POST',
    mutation: true,
    configRevision: 1,
    settingsRevision: 1,
    body: { kind: 'recurring', title: 'Настоящее повторение', recurrence: futureRecurrence() },
  });
  expect(result.status, JSON.stringify(result.envelope)).toBe(0);
});
function registerGuardAndCreationContracts(transport: Transport): void {
  it.each(['configure', 'control', 'tick', 'complete'] as const)(
    '%s rejects wrong ownership, epoch, configuration and timezone tokens without writes',
    async (kind) => {
      const parent = await harness.create('http');
      await harness.activate(parent.id);
      const occurrence = harness.occurrences(parent.id)[0];
      if (!occurrence) throw new Error('Expected an activated occurrence');
      let input: RecurrenceRequest;
      if (kind === 'configure') {
        input = {
          command: ['recurrence', 'configure', parent.id],
          path: `/projects/alpha/tasks/${parent.id}/recurrence`,
          scope: 'alpha',
          method: 'PUT',
          mutation: true,
          revision: harness.task(parent.id).revision,
          configRevision: 1,
          settingsRevision: 1,
          body: futureRecurrence(),
        };
      } else if (kind === 'control') input = harness.controlInput(parent.id, 'paused');
      else if (kind === 'complete') input = outcomeInput(parent.id, 'complete', [occurrence]);
      else
        input = {
          command: ['recurrence', 'tick'],
          path: '/projects/alpha/recurrence/tick',
          scope: 'alpha',
          method: 'POST',
          mutation: true,
          configRevision: 1,
          settingsRevision: 1,
          body: {
            tasks: [{ task_id: parent.id, expected_revision: harness.task(parent.id).revision }],
          },
        };
      const before = harness.snapshot();
      for (const [changed, code] of [
        [{ ...input, epoch: randomUUID() }, 'DATABASE_EPOCH_CONFLICT'],
        [{ ...input, configRevision: 99 }, 'CONFIG_CONFLICT'],
        [{ ...input, settingsRevision: 99 }, 'CONFIG_CONFLICT'],
        [
          { ...input, scope: 'beta', path: input.path.replace('/alpha/', '/beta/') },
          'PROJECT_MISMATCH',
        ],
      ] as const) {
        failure(await harness.request(transport, changed), transport, code);
        expect(harness.snapshot()).toEqual(before);
      }
    },
  );
  it.each(['carry_forward', 'record_miss'] as const)(
    'creates %s with explicit window/anchor and fixed source actor',
    async (policy) => {
      const recurrence = futureRecurrence({
        miss_policy: policy,
        confirmation_window_ms: 2592000000,
      });
      const operationId = randomUUID();
      const input: RecurrenceRequest = {
        command: ['task', 'create'],
        path: '/projects/alpha/tasks',
        scope: 'alpha',
        method: 'POST',
        mutation: true,
        configRevision: 1,
        settingsRevision: 1,
        operationId,
        body: {
          kind: 'recurring',
          title: 'Регулярная работа',
          description: '  **Точно** 👩🏽‍💻\n',
          recurrence,
        },
      };
      const created = recurrenceSuccess(await harness.request(transport, input), transport, 201);
      expect(created.data).toMatchObject({ kind: 'recurring', status_id: 'draft', deadline: null });
      const state = harness.snapshot();
      expect(recurrenceSuccess(await harness.request(transport, input), transport, 201)).toEqual(
        created,
      );
      expect(harness.snapshot()).toEqual(state);
      failure(
        await harness.request(transport, { ...input, body: { ...input.body, title: 'Иное' } }),
        transport,
        'IDEMPOTENCY_CONFLICT',
      );
      const audit = z
        .object({ actor: z.string(), origin: z.string() })
        .parse(
          harness.fixture.connection.sqlite
            .prepare('SELECT actor,origin FROM audit_records WHERE operation_id=?')
            .get(operationId),
        );
      expect(audit).toEqual(
        transport === 'cli'
          ? { actor: 'ai-cli:alpha', origin: 'cli' }
          : { actor: 'human-web', origin: 'web' },
      );
      expect(harness.snapshot()).toEqual(state);
    },
  );
}
function configureInput(parent: { id: string; revision: number }): RecurrenceRequest {
  return {
    command: ['recurrence', 'configure', parent.id],
    path: `/projects/alpha/tasks/${parent.id}/recurrence`,
    scope: 'alpha',
    method: 'PUT',
    mutation: true,
    revision: parent.revision,
    configRevision: 1,
    settingsRevision: 1,
    operationId: randomUUID(),
    body: futureRecurrence({ schedule: { mode: 'after_completion', unit: 'hours', every: 2 } }),
  };
}
async function configuredActiveParent() {
  const parent = await harness.create('http');
  recurrenceSuccess(await harness.request('http', configureInput(parent)), 'http');
  await harness.activate(parent.id);
  return parent;
}
function registerRecurrenceOutcomeContracts(transport: Transport): void {
  it('configures versioned settings with exact replay and controls activation', async () => {
    const parent = await harness.create('http');
    const configure = configureInput(parent);
    const configured = recurrenceSuccess(await harness.request(transport, configure), transport);
    const state = harness.snapshot();
    expect(recurrenceSuccess(await harness.request(transport, configure), transport)).toEqual(
      configured,
    );
    expect(harness.snapshot()).toEqual(state);
    recurrenceSuccess(
      await harness.request(transport, harness.controlInput(parent.id, 'active')),
      transport,
    );
    const first = harness.occurrences(parent.id)[0];
    if (!first) throw new Error('Activation must create its explicit initial occurrence');
  });
  it('explicitly ticks configured active recurrence and exact-replays without additional writes', async () => {
    const parent = await configuredActiveParent();
    const tick: RecurrenceRequest = {
      command: ['recurrence', 'tick'],
      path: '/projects/alpha/recurrence/tick',
      scope: 'alpha',
      method: 'POST',
      mutation: true,
      configRevision: 1,
      settingsRevision: 1,
      operationId: randomUUID(),
      body: {
        tasks: [{ task_id: parent.id, expected_revision: harness.task(parent.id).revision }],
      },
    };
    const processed = recurrenceSuccess(await harness.request(transport, tick), transport);
    const committed = harness.snapshot();
    expect(recurrenceSuccess(await harness.request(transport, tick), transport)).toEqual(processed);
    expect(harness.snapshot()).toEqual(committed);
  });
  it('reads recurrence, filtered occurrence lists and frozen occurrence detail without writes', async () => {
    const parent = await configuredActiveParent();
    const first = harness.occurrences(parent.id)[0];
    if (!first) throw new Error('Activation must create its explicit initial occurrence');
    recurrenceSuccess(
      await harness.request('http', {
        command: ['recurrence', 'tick'],
        path: '/projects/alpha/recurrence/tick',
        scope: 'alpha',
        method: 'POST',
        mutation: true,
        configRevision: 1,
        settingsRevision: 1,
        body: {
          tasks: [{ task_id: parent.id, expected_revision: harness.task(parent.id).revision }],
        },
      }),
      'http',
    );
    const committed = harness.snapshot();
    for (const read of [
      {
        command: ['recurrence', 'get', parent.id],
        path: `/projects/alpha/tasks/${parent.id}/recurrence`,
      },
      {
        command: ['occurrence', 'list', parent.id],
        path: `/projects/alpha/tasks/${parent.id}/occurrences?state=pending&limit=1`,
        body: { state: 'pending', limit: 1 },
      },
      {
        command: ['occurrence', 'get', parent.id, first.id],
        path: `/projects/alpha/tasks/${parent.id}/occurrences/${first.id}`,
      },
    ]) {
      const result = recurrenceSuccess(
        await harness.request(transport, { ...read, scope: 'alpha' }),
        transport,
      );
      expect(result.meta.database_epoch).toBe(harness.epoch);
      expect(harness.snapshot()).toEqual(committed);
    }
    const detail = recurrenceSuccess(
      await harness.request(transport, {
        command: ['occurrence', 'get', parent.id, first.id],
        path: `/projects/alpha/tasks/${parent.id}/occurrences/${first.id}`,
        scope: 'alpha',
      }),
      transport,
    );
    expect(detail.data).toMatchObject({
      id: first.id,
      task_id: parent.id,
      project_slug: 'alpha',
      description_snapshot: '  **Исходник** 👩🏽‍💻\n',
      schedule_snapshot: {
        timezone: 'Europe/Moscow',
        schedule: { mode: 'after_completion', unit: 'hours', every: 2 },
      },
    });
    expect(harness.snapshot()).toEqual(committed);
  });
  it('completes only explicitly selected occurrences and exact-replays the original response', async () => {
    const parent = await harness.create('http', {
      recurrence: futureRecurrence({
        first_deadline: new Date(Date.now() - 2 * 86400000).toISOString(),
        confirmation_window_ms: 2592000000,
      }),
    });
    await harness.activate(parent.id);
    recurrenceSuccess(
      await harness.request('http', {
        command: ['recurrence', 'tick'],
        path: '/projects/alpha/recurrence/tick',
        scope: 'alpha',
        method: 'POST',
        mutation: true,
        configRevision: 1,
        settingsRevision: 1,
        body: {
          tasks: [{ task_id: parent.id, expected_revision: harness.task(parent.id).revision }],
        },
      }),
      'http',
    );
    const rows = harness.occurrences(parent.id);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const selected = rows[0];
    if (!selected) throw new Error('Expected selected occurrence');
    const input = { ...outcomeInput(parent.id, 'complete', [selected]), operationId: randomUUID() };
    const completed = recurrenceSuccess(await harness.request(transport, input), transport);
    expect(harness.occurrences(parent.id).find((row) => row.id === selected.id)?.state).toBe(
      'completed',
    );
    expect(harness.occurrences(parent.id).filter((row) => row.id !== selected.id)).toEqual(
      rows.slice(1),
    );
    const snapshot = harness.snapshot();
    expect(recurrenceSuccess(await harness.request(transport, input), transport)).toEqual(
      completed,
    );
    expect(harness.snapshot()).toEqual(snapshot);
    failure(
      await harness.request(transport, {
        ...input,
        operationId: randomUUID(),
        revision: harness.task(parent.id).revision,
      }),
      transport,
      'REVISION_CONFLICT',
    );
    expect(harness.snapshot()).toEqual(snapshot);
    const current = harness.occurrences(parent.id).find((row) => row.id === selected.id);
    if (!current) throw new Error('Expected the completed occurrence');
    failure(
      await harness.request(transport, {
        ...outcomeInput(parent.id, 'complete', [current]),
        operationId: randomUUID(),
        revision: harness.task(parent.id).revision,
      }),
      transport,
      'VALIDATION_ERROR',
    );
    expect(harness.snapshot()).toEqual(snapshot);
  });
  it('cancels selected future pending rows only after pause and preserves exact reason/receipt', async () => {
    const parent = await harness.create('http');
    await harness.activate(parent.id);
    const selected = harness.occurrences(parent.id)[0];
    if (!selected) throw new Error('Expected future pending occurrence');
    const active = harness.snapshot();
    const invalid = await harness.request(transport, outcomeInput(parent.id, 'cancel', [selected]));
    expect(invalid.envelope.ok).toBe(false);
    expect(harness.snapshot()).toEqual(active);
    recurrenceSuccess(
      await harness.request('http', harness.controlInput(parent.id, 'paused')),
      'http',
    );
    const input = { ...outcomeInput(parent.id, 'cancel', [selected]), operationId: randomUUID() };
    const cancelled = recurrenceSuccess(await harness.request(transport, input), transport);
    expect(harness.occurrences(parent.id)[0]?.state).toBe('cancelled');
    expect(
      harness.fixture.connection.sqlite
        .prepare('SELECT cancel_reason FROM occurrences WHERE id=?')
        .get(selected.id),
    ).toEqual({ cancel_reason: 'Период больше не нужен' });
    const committed = harness.snapshot();
    expect(recurrenceSuccess(await harness.request(transport, input), transport)).toEqual(
      cancelled,
    );
    expect(harness.snapshot()).toEqual(committed);
  });
}
function settingsUpdateInput(): RecurrenceRequest {
  return {
    command: ['settings', 'update'],
    path: '/projects/alpha/application-settings',
    scope: 'alpha',
    method: 'PATCH',
    mutation: true,
    configRevision: 1,
    settingsRevision: 1,
    operationId: randomUUID(),
    body: { timezone: 'Europe/Berlin' },
  };
}
function registerLifecycleAndSettingsContracts(transport: Transport): void {
  it('uses configured recurring restore confirmation without failed-write audit or hidden activation', async () => {
    const parent = await harness.create('http');
    recurrenceSuccess(
      await harness.request('http', {
        command: ['task', 'archive', parent.id],
        path: `/projects/alpha/tasks/${parent.id}/archive`,
        scope: 'alpha',
        method: 'POST',
        mutation: true,
        revision: 1,
        configRevision: 1,
        settingsRevision: 1,
        body: {},
      }),
      'http',
    );
    const before = harness.snapshot();
    const restore: RecurrenceRequest = {
      command: ['task', 'restore', parent.id],
      path: `/projects/alpha/tasks/${parent.id}/restore`,
      scope: 'alpha',
      method: 'POST',
      mutation: true,
      revision: harness.task(parent.id).revision,
      configRevision: 1,
      settingsRevision: 1,
      body: {},
    };
    failure(await harness.request(transport, restore), transport, 'CONFIRMATION_REQUIRED');
    expect(harness.snapshot()).toEqual(before);
    for (const confirmation of [{ asserted: true }, { asserted: true, user_text: '   ' }]) {
      const invalid = await harness.request(transport, { ...restore, body: { confirmation } });
      expect(invalid.envelope.ok).toBe(false);
      expect(harness.snapshot()).toEqual(before);
    }
    const confirmation = {
      asserted: true,
      user_text: '  Восстановить именно эту задачу в паузу 👩🏽‍💻\n',
    };
    const operationId = randomUUID();
    const result = recurrenceSuccess(
      await harness.request(transport, { ...restore, operationId, body: { confirmation } }),
      transport,
    );
    expect(result.data).toMatchObject({
      status_id: 'paused',
      category: 'paused',
      archived_at: null,
    });
    const event = z
      .object({ confirmation: z.string(), actor: z.string() })
      .parse(
        harness.fixture.connection.sqlite
          .prepare('SELECT confirmation,actor FROM audit_records WHERE operation_id=? AND action=?')
          .get(operationId, 'task.restore'),
      );
    expect(JSON.parse(event.confirmation)).toEqual(confirmation);
    expect(event.actor).toBe(transport === 'cli' ? 'ai-cli:alpha' : 'human-web');
    expect(harness.occurrences(parent.id)).toEqual([]);
  });
  it('rejects recurring confirmation fields on an ordinary restore atomically', async () => {
    const task = await harness.archivedOrdinary();
    const before = harness.snapshot();
    const input: RecurrenceRequest = {
      command: ['task', 'restore', task.id],
      path: `/projects/alpha/tasks/${task.id}/restore`,
      scope: 'alpha',
      method: 'POST',
      mutation: true,
      revision: task.revision,
      configRevision: 1,
      body: { confirmation: { asserted: true, user_text: 'Не относится к обычной задаче' } },
    };
    failure(await harness.request(transport, input), transport, 'VALIDATION_ERROR');
    expect(harness.snapshot()).toEqual(before);
  });
  it('reads shared settings without writes', async () => {
    const before = harness.snapshot();
    const settings = recurrenceSuccess(
      await harness.request(transport, {
        command: ['settings', 'get'],
        path: '/settings?all_projects=true',
      }),
      transport,
    );
    expect(settings.data).toMatchObject({
      timezone: 'Europe/Moscow',
      revision: 1,
      database_epoch: harness.epoch,
    });
    expect(harness.snapshot()).toEqual(before);
  });
  it.each(['epoch', 'configuration', 'settings'] as const)(
    'rejects a stale %s token on settings update without writes',
    async (guard) => {
      const before = harness.snapshot();
      const input = settingsUpdateInput();
      const invalid =
        guard === 'epoch'
          ? { ...input, epoch: randomUUID() }
          : guard === 'configuration'
            ? { ...input, configRevision: 99 }
            : { ...input, settingsRevision: 99 };
      const result = await harness.request(transport, invalid);
      expect(result.envelope.ok).toBe(false);
      failure(result, transport, guard === 'epoch' ? 'DATABASE_EPOCH_CONFLICT' : 'CONFIG_CONFLICT');
      expect(harness.snapshot()).toEqual(before);
    },
  );
  it('changes timezone and exactly replays the original result without writes', async () => {
    const input = settingsUpdateInput();
    const changed = recurrenceSuccess(await harness.request(transport, input), transport);
    expect(changed.data).toMatchObject({
      timezone: 'Europe/Berlin',
      revision: 2,
      database_epoch: harness.epoch,
    });
    const committed = harness.snapshot();
    expect(recurrenceSuccess(await harness.request(transport, input), transport)).toEqual(changed);
    expect(harness.snapshot()).toEqual(committed);
  });
  it('rejects changed settings payload under a committed operation identity atomically', async () => {
    const input = settingsUpdateInput();
    const changed = recurrenceSuccess(await harness.request(transport, input), transport);
    expect(changed.data).toMatchObject({
      timezone: 'Europe/Berlin',
      revision: 2,
      database_epoch: harness.epoch,
    });
    const committed = harness.snapshot();
    failure(
      await harness.request(transport, { ...input, body: { timezone: 'UTC' } }),
      transport,
      'IDEMPOTENCY_CONFLICT',
    );
    expect(harness.snapshot()).toEqual(committed);
  });
}
describe.each(['cli', 'http'] as const)('%s recurring adapters', (transport) => {
  registerGuardAndCreationContracts(transport);
  registerRecurrenceOutcomeContracts(transport);
  registerLifecycleAndSettingsContracts(transport);
});
