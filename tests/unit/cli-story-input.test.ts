import { expect, it } from 'vitest';
import { createProgram } from '../../src/cli/main.js';
import { queryInput, singleProjectInput } from '../../src/cli/command-helpers.js';
import { readJsonInput } from '../../src/cli/io.js';
import { taskListInputSchema } from '../../src/core/queries/tasks.js';
import { projectListInputSchema } from '../../src/core/queries/projects.js';
import { parseInput } from '../../src/core/validation.js';

it('registers the complete US1 through US3 command families while preserving bootstrap commands', () => {
  const program = createProgram();
  expect(program.commands.map((command) => command.name())).toEqual(
    expect.arrayContaining([
      'help',
      'version',
      'meta',
      'serve',
      'project',
      'task',
      'description',
      'config',
      'dependency',
      'audit',
    ]),
  );
  for (const [family, commands] of [
    ['project', ['list', 'get', 'create', 'update', 'archive', 'restore']],
    ['task', ['list', 'get', 'create', 'update', 'transition', 'archive', 'restore']],
    ['description', ['preview']],
    ['config', ['get', 'preview', 'migrate', 'presets']],
    ['dependency', ['list', 'add', 'remove']],
    ['audit', ['list']],
  ] as const) {
    expect(
      program.commands
        .find((command) => command.name() === family)
        ?.commands.map((command) => command.name()),
    ).toEqual([...commands]);
  }
});

it('maps list flags and structured priority input without modifying the original proposal', () => {
  const priority = { model: 'eisenhower' as const, important: true, urgent: false };
  const body = Object.freeze({ priority });
  expect(
    parseInput(
      taskListInputSchema,
      queryInput(
        {
          project: 'alpha',
          status: 'idea',
          limit: '25',
          q: 'Процент %_',
          includeTerminal: true,
        },
        body,
      ),
    ),
  ).toMatchObject({
    project_slug: 'alpha',
    status_id: 'idea',
    limit: 25,
    q: 'Процент %_',
    include_terminal: true,
    priority,
  });
  expect(body).toEqual({ priority });
});

it.each([
  ['q', 'q', 'needle', 'needle'],
  ['status', 'status_id', 'idea', 'idea'],
  ['category', 'category', 'review', 'review'],
  ['kind', 'kind', 'ordinary', 'ordinary'],
  ['emoji', 'emoji', '✈️', '✈️'],
  ['archive', 'archive', 'only', 'only'],
  ['limit', 'limit', '50', 50],
  ['cursor', 'cursor', 'opaque', 'opaque'],
  ['includeTerminal', 'include_terminal', true, true],
  [
    'entityId',
    'entity_id',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
  ],
  [
    'operation',
    'operation_id',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
  ],
] as const)(
  'rejects %s supplied through both a flag and JSON, even when equal',
  (option, field, flag, value) => {
    expect(() => queryInput({ project: 'alpha', [option]: flag }, { [field]: value })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  },
);

it('requires scope flags while allowing only a matching redundant project_slug in JSON', () => {
  expect(
    singleProjectInput({ project: 'alpha' }, { project_slug: 'alpha', description: 'Оригинал' }),
  ).toEqual({ projectSlug: 'alpha', body: { description: 'Оригинал' } });
  expect(() => singleProjectInput({ allProjects: true }, {})).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(() => queryInput({}, { project_slug: 'alpha' })).toThrow();
  expect(() => queryInput({ allProjects: true }, { all_projects: true })).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(() => singleProjectInput({ project: 'alpha' }, { project_slug: 'beta' })).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
});

it('preserves unknown own __proto__ input until the strict query schema rejects it', async () => {
  async function* source() {
    yield new TextEncoder().encode('{"__proto__":{"q":"injected"},"limit":5}');
  }
  const body = await readJsonInput('-', source());
  const query = queryInput({ project: 'alpha' }, body);
  expect(Object.hasOwn(query, '__proto__')).toBe(true);
  expect(() => parseInput(taskListInputSchema, query)).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(() => parseInput(projectListInputSchema, query)).toThrow(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
});

it('forwards undeclared clock and actor fields to strict validation instead of discarding them', () => {
  for (const body of [{ now: 0 }, { as_of: '2026-01-01T00:00:00.000Z' }, { actor: 'human-web' }]) {
    const query = queryInput({ allProjects: true }, body);
    expect(() => parseInput(taskListInputSchema, query)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  }
});
