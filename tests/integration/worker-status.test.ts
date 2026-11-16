import { afterEach, beforeEach, expect, it } from 'vitest';
import { attachAdvisories } from '../../src/core/advisories/attach.js';
import { workerProvider } from '../../src/core/advisories/providers/worker.js';
import { readMeta } from '../../src/core/queries/meta.js';
import { getProject } from '../../src/core/queries/projects.js';
import { listOccurrences } from '../../src/core/queries/recurrence.js';
import { createPassRecorder } from '../../src/core/worker/record-pass.js';
import { workerStatus, WORKER_TOLERANCE_MS } from '../../src/core/worker/status.js';
import { seedOutcomeParent } from '../fixtures/occurrence-outcomes.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';
import {
  createRecurring,
  dayMs,
  generationFixture,
  readContext,
  rule,
} from '../fixtures/recurrence-generations.js';

/** Spec 011 on a real database: pass record, status, advisory on dependent reads. */
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

const minute = 60_000;
const passCount = () =>
  fixture.connection.sqlite.prepare('SELECT count(*) FROM worker_passes').pluck().get();
function advised(taskId: string, now: number) {
  const envelope = listOccurrences(readContext(fixture), 'alpha', taskId, {});
  const result = attachAdvisories(
    fixture.connection.db,
    { operation: 'occurrence.list', projectSlug: 'alpha' },
    envelope,
    [workerProvider(() => now)],
  ) as { advisories?: { code: string; remedy: { text: string; command?: string } }[] };
  return { items: envelope.data.items.length, advisories: result.advisories ?? [] };
}

it('tells "no occurrence today" from "worker not running" in one read (US2, SC-002, 8 Nov case)', () => {
  const parent = seedOutcomeParent(fixture, {});
  const now = fixture.clock.now();
  fixture.connection.sqlite.prepare('DELETE FROM occurrences WHERE task_id = ?').run(parent.id);
  expect(advised(parent.id, now)).toMatchObject({
    items: 0,
    advisories: [{ code: 'worker_never_ran' }],
  });
  const record = createPassRecorder(fixture.connection, 'alpha');
  record(now);
  expect(advised(parent.id, now).advisories).toEqual([]);
  const stale = advised(parent.id, now + WORKER_TOLERANCE_MS + 1).advisories;
  expect(stale).toMatchObject([{ code: 'worker_stale', remedy: { command: 'serve' } }]);
  expect(stale[0]?.remedy.text).toContain('worker run --project alpha');
  expect(stale[0]?.remedy.text).toContain(new Date(now).toISOString());
  expect(advised(parent.id, now + WORKER_TOLERANCE_MS).advisories).toEqual([]);
});

it('no active recurring task, no advisory, even when the worker never ran (US2-3)', () => {
  const draft = createRecurring(fixture, rule(fixture.clock.now() + dayMs));
  expect(advised(draft, fixture.clock.now()).advisories).toEqual([]);
});

it('status shows in meta and project reads, and reading it writes nothing (FR-002, FR-007)', () => {
  const now = fixture.clock.now();
  const changes = fixture.connection.sqlite.prepare('SELECT total_changes()').pluck();
  const before = changes.get();
  const meta = readMeta(readContext(fixture), { all_projects: true }).data.workers;
  expect(meta).toEqual([{ project_slug: 'alpha', status: 'never', tolerance_seconds: 300 }]);
  expect(getProject(readContext(fixture), 'alpha').data.worker).toEqual({ status: 'never' });
  expect(changes.get()).toBe(before);
  createPassRecorder(fixture.connection, 'alpha')(now);
  expect(readMeta(readContext(fixture), { all_projects: true }).data.workers).toEqual([
    {
      project_slug: 'alpha',
      status: 'healthy',
      last_pass_at: new Date(now).toISOString(),
      tolerance_seconds: 300,
    },
  ]);
});

it('writes at most once a minute; the last write wins after the clock moves back', () => {
  const record = createPassRecorder(fixture.connection, 'alpha');
  const now = fixture.clock.now();
  const last = () =>
    fixture.connection.sqlite.prepare('SELECT last_pass_at FROM worker_passes').pluck().get();
  expect(record(now)).toBe(true);
  expect(record(now + 30_000)).toBe(false);
  expect(record(now + minute)).toBe(true);
  expect(last()).toBe(now + minute);
  expect(record(now - 60 * minute)).toBe(true);
  expect(last()).toBe(now - 60 * minute);
  expect(passCount()).toBe(1);
});

it('100 passes every 30 s with clock steps of ±2 min and -1 h: never stale (SC-004)', () => {
  const record = createPassRecorder(fixture.connection, 'alpha');
  const steps = new Map([
    [20, 2 * minute],
    [45, -2 * minute],
    [70, -60 * minute],
  ]);
  let clock = fixture.clock.now();
  const read = () =>
    Number(
      fixture.connection.sqlite.prepare('SELECT last_pass_at FROM worker_passes').pluck().get(),
    );
  const stale: number[] = [];
  for (let pass = 0; pass < 100; pass += 1) {
    clock += 30_000 + (steps.get(pass) ?? 0);
    record(clock);
    if (workerStatus(read(), clock) !== 'healthy') stale.push(pass);
  }
  expect(stale).toEqual([]);
});
