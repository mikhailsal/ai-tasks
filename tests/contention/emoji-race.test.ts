import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import type { HelperCommand } from '../../src/api/helper-protocol.js';
import { mutationSuccessEnvelopeSchema } from '../../src/schema/envelopes.js';
import { createContentionWriters } from '../fixtures/contention-writers.js';
import {
  createOrdinaryFixture,
  durableCounts,
  initialWork,
  ordinaryInput,
  taskShape,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture;
let work: Awaited<ReturnType<typeof initialWork>>;
const pools: Awaited<ReturnType<typeof createContentionWriters>>[] = [];
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  work = await initialWork(fixture);
});
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
  await fixture?.close();
});
function taskCreate(slug: string): HelperCommand {
  return {
    operation: 'task.create',
    scope: { project_slug: slug },
    input: ordinaryInput(
      fixture,
      { kind: 'ordinary', title: 'Конкурирующая задача', emoji: '🎯' },
      { projectSlug: slug },
    ),
  };
}
function counts() {
  const value = durableCounts(fixture);
  return { audit: Number(value.audit), receipt: Number(value.receipt) };
}
async function race(commands: HelperCommand[]) {
  const pool = await createContentionWriters(fixture, commands);
  pools.push(pool);
  expect(new Set(pool.helpers).size).toBe(commands.length);
  expect(new Set(pool.workers).size).toBe(commands.length);
  pool.release();
  return pool.results;
}
type RaceResult = Awaited<ReturnType<typeof race>>;
function oneWinner(results: RaceResult) {
  expect(results.filter((result) => result.envelope.ok)).toHaveLength(1);
  const winner = results.find((result) => result.envelope.ok);
  const loser = results.find((result) => !result.envelope.ok);
  if (!winner || !loser) throw new Error('Missing marker race winner/loser');
  expect(loser.envelope).toMatchObject({
    ok: false,
    error: { code: 'EMOJI_CONFLICT' },
  });
  return { winner, loser };
}
function markerTasks() {
  return z
    .array(z.object({ id: z.uuid(), project_slug: z.string() }))
    .parse(
      fixture.connection.sqlite
        .prepare("SELECT id, project_slug FROM tasks WHERE emoji_key='🎯'")
        .all(),
    );
}
it('serializes competing same-project task marker claims and exact-replays the winner once', async () => {
  const commands = [taskCreate('alpha'), taskCreate('alpha')];
  const before = counts();
  const { winner, loser } = oneWinner(await race(commands));
  expect(markerTasks()).toHaveLength(1);
  expect(counts()).toEqual({ audit: before.audit + 1, receipt: before.receipt + 1 });
  const command = commands[winner.workerId];
  const failed = commands[loser.workerId];
  if (!command || !failed || !('input' in failed)) throw new Error('Missing race command');
  const [replayed] = await race([command]);
  expect(replayed?.envelope).toEqual(winner.envelope);
  expect(counts()).toEqual({ audit: before.audit + 1, receipt: before.receipt + 1 });
  expect(
    fixture.connection.sqlite
      .prepare('SELECT count(*) FROM operation_receipts WHERE operation_id=?')
      .pluck()
      .get(z.object({ operation_id: z.uuid() }).parse(failed.input).operation_id),
  ).toBe(0);
});
it('permits the same nonproject task marker in independent project namespaces under concurrent writes', async () => {
  const before = counts();
  const results = await race([taskCreate('alpha'), taskCreate('beta')]);
  expect(results.map((result) => result.envelope.ok)).toEqual([true, true]);
  expect(
    markerTasks()
      .map((task) => task.project_slug)
      .sort(),
  ).toEqual(['alpha', 'beta']);
  expect(counts()).toEqual({ audit: before.audit + 2, receipt: before.receipt + 2 });
});
it('updates only one of two existing parents claiming the same task marker without losing old reservations', async () => {
  const second = taskShape.parse(
    work.api.createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { kind: 'ordinary', title: 'Вторая задача', emoji: '🧩' }),
    ).data,
  );
  const commands: HelperCommand[] = [work.task.id, second.id].map((taskId) => ({
    operation: 'task.update',
    scope: { project_slug: 'alpha' },
    task_id: taskId,
    input: ordinaryInput(fixture, { emoji: '🎯' }, { revision: 1 }),
  }));
  const before = counts();
  const { winner } = oneWinner(await race(commands));
  const saved = taskShape.parse(mutationSuccessEnvelopeSchema.parse(winner.envelope).data);
  const rows = z
    .array(z.object({ id: z.uuid(), emoji_key: z.string(), revision: z.number() }))
    .parse(
      fixture.connection.sqlite
        .prepare("SELECT id, emoji_key, revision FROM tasks WHERE project_slug='alpha'")
        .all(),
    );
  expect(rows.find((row) => row.id === saved.id)).toMatchObject({
    emoji_key: '🎯',
    revision: 2,
  });
  const loser = rows.find((row) => row.id !== saved.id);
  expect(loser).toMatchObject({ revision: 1 });
  expect(loser?.emoji_key).toBe(saved.id === second.id ? '🟣' : '🧩');
  expect(
    fixture.connection.sqlite
      .prepare("SELECT count(*) FROM task_emoji_reservations WHERE project_slug='alpha'")
      .pluck()
      .get(),
  ).toBe(2);
  expect(counts()).toEqual({ audit: before.audit + 1, receipt: before.receipt + 1 });
});
it('serializes globally exclusive project markers and keeps the winning owner reserved after archive', async () => {
  const commands: HelperCommand[] = ['gamma', 'delta'].map((slug) => ({
    operation: 'project.create',
    scope: { project_slug: slug },
    input: ordinaryInput(
      fixture,
      { slug, name: `Проект ${slug}`, emoji: '🎯' },
      { projectSlug: slug },
    ),
  }));
  const before = counts();
  const { winner, loser } = oneWinner(await race(commands));
  const saved = z
    .object({ slug: z.string(), revision: z.number() })
    .parse(mutationSuccessEnvelopeSchema.parse(winner.envelope).data);
  work.api.archiveProject(
    fixture.human,
    saved.slug,
    ordinaryInput(fixture, { affected_tasks: [] }, { projectSlug: saved.slug, revision: 1 }),
  );
  const original = commands[loser.workerId];
  if (!original || !('scope' in original) || !('project_slug' in original.scope))
    throw new Error('Missing losing project scope');
  const slug = original.scope.project_slug;
  const [retry] = await race([
    {
      operation: 'project.create',
      scope: { project_slug: slug },
      input: ordinaryInput(
        fixture,
        { slug, name: 'Повторная попытка', emoji: '🎯' },
        { projectSlug: slug },
      ),
    },
  ]);
  expect(retry?.envelope).toMatchObject({ ok: false, error: { code: 'EMOJI_CONFLICT' } });
  expect(
    fixture.connection.sqlite
      .prepare("SELECT project_slug FROM project_emoji_reservations WHERE emoji_key='🎯'")
      .get(),
  ).toEqual({ project_slug: saved.slug });
  expect(counts()).toEqual({ audit: before.audit + 2, receipt: before.receipt + 2 });
});
it('resolves a simultaneous permanent project claim against a task claim without rewriting the losing entity', async () => {
  const commands: HelperCommand[] = [
    {
      operation: 'project.update',
      scope: { project_slug: 'alpha' },
      input: ordinaryInput(fixture, { emoji: '🎯' }, { revision: 1 }),
    },
    taskCreate('beta'),
  ];
  const before = counts();
  const { winner } = oneWinner(await race(commands));
  const permanent = fixture.connection.sqlite
    .prepare("SELECT project_slug FROM project_emoji_reservations WHERE emoji_key='🎯'")
    .get();
  if (winner.workerId === 0) {
    expect(permanent).toEqual({ project_slug: 'alpha' });
    expect(markerTasks()).toEqual([]);
  } else {
    expect(permanent).toBeUndefined();
    expect(markerTasks()).toHaveLength(1);
    expect(
      fixture.connection.sqlite
        .prepare("SELECT emoji,revision FROM projects WHERE slug='alpha'")
        .get(),
    ).toEqual({ emoji: '🔵', revision: 1 });
  }
  expect(
    fixture.connection.sqlite
      .prepare("SELECT project_slug FROM project_emoji_reservations WHERE emoji_key='🔵'")
      .get(),
  ).toEqual({ project_slug: 'alpha' });
  expect(counts()).toEqual({ audit: before.audit + 1, receipt: before.receipt + 1 });
});
