import { expect, it, vi } from 'vitest';
import { createProgram } from '../../src/cli/main.js';
import { queryInput, writeSuccess } from '../../src/cli/command-helpers.js';
import { parseInput } from '../../src/core/validation.js';
import {
  agendaInputSchema,
  prioritiesInputSchema,
  statisticsInputSchema,
} from '../../src/schema/read-views.js';
import { listPriorities } from '../../src/core/queries/priorities.js';
import { getStatistics } from '../../src/core/queries/statistics.js';
import { createReadViewsFixture } from '../fixtures/read-views.js';

it('registers the three top-level read views without duplicate or nested registrations', () => {
  const program = createProgram();
  for (const name of ['agenda', 'priorities', 'stats']) {
    const matches = program.commands.filter((command) => command.name() === name);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.commands).toHaveLength(0);
  }
});

it.each([
  ['stats', '--limit', '1'],
  ['stats', '--cursor', 'opaque'],
  ['agenda', '--state', 'pending'],
  ['priorities', '--operation-id', '00000000-0000-4000-8000-000000000001'],
])('rejects %s %s before opening any database', async (...args) => {
  await expect(
    createProgram().parseAsync([...args, '--all-projects'], { from: 'user' }),
  ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});

it('retains complete priority/null JSON and half-open timestamp bounds with normalized list flags', () => {
  const priority = { model: 'eisenhower' as const, important: false, urgent: true };
  expect(
    parseInput(
      agendaInputSchema,
      queryInput({ allProjects: true, limit: '2', category: 'review' }, { priority }),
    ),
  ).toMatchObject({ all_projects: true, limit: 2, category: 'review', priority });
  expect(
    parseInput(prioritiesInputSchema, queryInput({ project: 'classic' }, { priority: null })),
  ).toMatchObject({ project_slug: 'classic', priority: null });
  const from = '2026-03-28T22:00:00.123Z';
  expect(
    parseInput(statisticsInputSchema, queryInput({ project: 'classic' }, { from, to: from })),
  ).toMatchObject({ project_slug: 'classic', from, to: from });
  expect(() =>
    parseInput(statisticsInputSchema, queryInput({ allProjects: true }, { limit: 1 })),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
});

it('rejects duplicated query flags and unknown own keys rather than silently dropping them', () => {
  expect(() => queryInput({ allProjects: true, q: 'literal' }, { q: 'literal' })).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  const body = JSON.parse('{"__proto__":{"q":"injected"}}');
  for (const schema of [agendaInputSchema, prioritiesInputSchema, statisticsInputSchema])
    expect(() => parseInput(schema, queryInput({ allProjects: true }, body))).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
});

it('human grouped output explains real models, tasks and distinct counters while JSON output stays byte-for-byte', async () => {
  const view = await createReadViewsFixture();
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  try {
    const before = view.snapshot();
    const priorities = listPriorities(view.readContext, { all_projects: true, q: 'rank:' });
    writeSuccess(priorities, {});
    const text = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(text).toContain('max-numeric');
    expect(text).toContain('Числовая шкала');
    expect(text).toContain('rank: best');
    stdout.mockClear();
    const stats = getStatistics(view.readContext, {
      project_slug: 'classic',
      q: 'stats:',
      include_terminal: true,
    });
    writeSuccess(stats, {});
    const counters = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(counters).toContain('Задачи: 4; обычные 3; повторяющиеся 1');
    expect(counters).toContain('Повторения: ожидают 1; долги 1');
    stdout.mockClear();
    writeSuccess(stats, { json: true });
    expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toBe(
      `${JSON.stringify(stats)}\n`,
    );
    expect(view.snapshot()).toEqual(before);
  } finally {
    stdout.mockRestore();
    await view.fixture.close();
  }
});
