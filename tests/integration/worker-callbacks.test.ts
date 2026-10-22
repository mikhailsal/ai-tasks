import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod/mini';
import { workerCallbacks, workerTickInput } from '../../src/cli/worker-data.js';
import { createContext } from '../../src/core/context.js';
import * as dueModule from '../../src/core/queries/due-work.js';
import { tickRecurrence } from '../../src/core/recurrence/tick.js';
import { archiveProject } from '../../src/core/projects/commands.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import { generationFixture, readContext } from '../fixtures/recurrence-generations.js';
import {
  outcomeSnapshot,
  seedOccurrence,
  seedOutcomeParent,
} from '../fixtures/occurrence-outcomes.js';
import {
  invokeOrdinaryCli,
  ordinaryInput,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => {
  vi.restoreAllMocks();
  fixture.close();
});
function dueParent() {
  const parent = seedOutcomeParent(fixture, {
    status: 'paused',
    deadline: fixture.clock.now() - 100,
  });
  seedOccurrence(fixture, parent);
  return parent;
}
function discovery() {
  return dueModule.discoverDueWork(readContext(fixture), 'alpha');
}
function receipt(operationId: string) {
  return fixture.connection.sqlite
    .prepare('SELECT operation_id FROM operation_receipts WHERE operation_id=?')
    .get(operationId);
}
it('the same fresh discovery yields one deterministic UUID and exact receipt replay despite clock passage', () => {
  dueParent();
  const first = workerTickInput('alpha', discovery());
  fixture.clock.advanceBy(1000);
  const second = workerTickInput('alpha', discovery());
  expect(second).toEqual(first);
  expect(z.uuid().parse(first.operation_id)).toBe(first.operation_id);
  const context = createContext({
    connection: fixture.connection,
    actor: 'ai-cli:alpha',
    origin: 'recurrence-worker',
    now: fixture.clock.now,
  });
  const result = tickRecurrence(context, 'alpha', first);
  const committed = outcomeSnapshot(fixture);
  fixture.clock.advanceBy(1000);
  expect(tickRecurrence(context, 'alpha', second)).toEqual(result);
  expect(outcomeSnapshot(fixture)).toEqual(committed);
});
it('scope, epoch, task/config/settings guards and selected task identity each change the deterministic UUID', () => {
  dueParent();
  const source = discovery();
  const original = workerTickInput('alpha', source).operation_id;
  const variants = [
    { ...source, meta: { ...source.meta, database_epoch: randomUUID() } },
    { ...source, data: { ...source.data, expected_config_revision: 2 } },
    { ...source, data: { ...source.data, expected_settings_revision: 2 } },
    {
      ...source,
      data: {
        ...source.data,
        tasks: source.data.tasks.map((row) => ({
          ...row,
          expected_revision: row.expected_revision + 1,
        })),
      },
    },
    {
      ...source,
      data: { ...source.data, tasks: [{ task_id: randomUUID(), expected_revision: 1 }] },
    },
  ];
  const ids = variants.map((value) => workerTickInput('alpha', value).operation_id);
  ids.push(workerTickInput('beta', source).operation_id);
  expect(new Set([original, ...ids]).size).toBe(ids.length + 1);
  for (const id of ids) expect(z.uuid().parse(id)).toBe(id);
});
it('a real independent CLI write between discovery and tick causes fresh reread without a stale receipt or audit', () => {
  const parent = dueParent();
  const originalQuery = dueModule.discoverDueWork;
  const stale = workerTickInput('alpha', discovery());
  let competingWrite = false;
  const query = vi.spyOn(dueModule, 'discoverDueWork').mockImplementation((...args) => {
    const result = originalQuery(...args);
    if (!competingWrite) {
      competingWrite = true;
      const guards = {
        operation_id: randomUUID(),
        database_epoch: fixture.epoch,
        expected_revision: 1,
        expected_config_revision: 1,
      };
      const updated = invokeOrdinaryCli(
        fixture,
        ['task', 'update', parent.id, '--project', 'alpha', '--json', '--input', '-'],
        jsonValueSchema.parse({ ...guards, description: 'Из другого процесса: точный исходник  ' }),
      );
      expect(updated.error).toBeUndefined();
      expect(updated.status, updated.stderr).toBe(0);
      expect(updated.stderr).toBe('');
    }
    return result;
  });
  const callbacks = workerCallbacks(fixture.connection, 'alpha');
  expect(callbacks.processBatch()).toEqual({ hasMore: true });
  expect(query).toHaveBeenCalledTimes(1);
  expect(receipt(stale.operation_id)).toBeUndefined();
  expect(
    fixture.connection.sqlite
      .prepare('SELECT id FROM audit_records WHERE operation_id=?')
      .get(stale.operation_id),
  ).toBeUndefined();
  const fresh = workerTickInput('alpha', originalQuery(readContext(fixture), 'alpha'));
  expect(fresh.operation_id).not.toBe(stale.operation_id);
  expect(fresh.payload).toEqual({ tasks: [{ task_id: parent.id, expected_revision: 2 }] });
  expect(callbacks.processBatch()).toEqual({ hasMore: false });
  expect(query).toHaveBeenCalledTimes(2);
  expect(receipt(fresh.operation_id)).toBeDefined();
  const audit = z
    .array(z.object({ actor: z.string(), origin: z.string() }))
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT actor,origin FROM audit_records WHERE operation_id=?')
        .all(fresh.operation_id),
    );
  expect(audit.length).toBeGreaterThan(0);
  for (const event of audit)
    expect(event).toEqual({ actor: 'ai-cli:alpha', origin: 'recurrence-worker' });
  expect(
    fixture.connection.sqlite
      .prepare('SELECT description,revision FROM tasks WHERE id=?')
      .get(parent.id),
  ).toEqual({ description: 'Из другого процесса: точный исходник  ', revision: 3 });
  expect(callbacks.processBatch()).toEqual({ hasMore: false });
  expect(query).toHaveBeenCalledTimes(3);
});
it('a project archived after discovery drops the cached tick without terminating on its lifecycle rejection', () => {
  const parent = seedOutcomeParent(fixture, { mode: 'calendar' });
  seedOccurrence(fixture, parent, { state: 'missed', key: `calendar:${parent.deadline}` });
  const stale = workerTickInput('alpha', discovery());
  expect(stale.payload).toEqual({ tasks: [{ task_id: parent.id, expected_revision: 1 }] });
  const originalQuery = dueModule.discoverDueWork;
  let archived = false;
  vi.spyOn(dueModule, 'discoverDueWork').mockImplementation((...args) => {
    const result = originalQuery(...args);
    if (!archived) {
      archived = true;
      archiveProject(
        fixture.human,
        'alpha',
        ordinaryInput(
          fixture,
          {
            affected_tasks: [{ task_id: parent.id, expected_revision: 1 }],
          },
          { revision: 1 },
        ),
      );
    }
    return result;
  });
  const callbacks = workerCallbacks(fixture.connection, 'alpha');
  expect(callbacks.processBatch()).toEqual({ hasMore: false });
  expect(receipt(stale.operation_id)).toBeUndefined();
  expect(
    fixture.connection.sqlite
      .prepare('SELECT id FROM audit_records WHERE operation_id=?')
      .get(stale.operation_id),
  ).toBeUndefined();
  expect(
    fixture.connection.sqlite
      .prepare('SELECT revision FROM tasks WHERE id=?')
      .pluck()
      .get(parent.id),
  ).toBe(1);
  const committed = outcomeSnapshot(fixture);
  expect(callbacks.processBatch()).toEqual({ hasMore: false });
  expect(outcomeSnapshot(fixture)).toEqual(committed);
});
