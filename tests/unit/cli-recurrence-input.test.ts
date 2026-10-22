import { expect, it } from 'vitest';
import { createProgram } from '../../src/cli/main.js';
import { occurrenceQueryInput } from '../../src/cli/commands/occurrences.js';

it('registers all recurrence, occurrence, and settings contract commands', () => {
  const program = createProgram();
  for (const [family, commands] of [
    ['recurrence', ['get', 'configure', 'control', 'tick']],
    ['occurrence', ['list', 'get', 'complete', 'cancel']],
    ['settings', ['get', 'update']],
  ] as const) {
    expect(
      program.commands
        .find((command) => command.name() === family)
        ?.commands.map((command) => command.name()),
    ).toEqual([...commands]);
  }
});

it('parses occurrence flags without altering the source JSON or adding query scope fields', () => {
  const source = Object.freeze({ cursor: 'opaque' });
  expect(occurrenceQueryInput({ project: 'alpha', state: 'debt', limit: '12' }, source)).toEqual({
    projectSlug: 'alpha',
    query: { state: 'debt', limit: 12, cursor: 'opaque' },
  });
  expect(source).toEqual({ cursor: 'opaque' });
});

it.each([
  ['state', 'pending', 'pending'],
  ['limit', '12', 12],
  ['cursor', 'opaque', 'opaque'],
] as const)('rejects duplicate %s flag and JSON even when equal', (field, flag, value) => {
  expect(() =>
    occurrenceQueryInput({ project: 'alpha', [field]: flag }, { [field]: value }),
  ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
});

it('rejects unknown own JSON keys and caller supplied time or actor', () => {
  for (const source of ['{"__proto__":{}}', '{"now":0}', '{"actor":"human-web"}']) {
    expect(() => occurrenceQueryInput({ project: 'alpha' }, JSON.parse(source))).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  }
});

it('requires a single project for occurrence listing and validates state and page bounds', () => {
  for (const options of [
    { allProjects: true },
    { project: 'alpha', state: 'unknown' },
    { project: 'alpha', limit: '201' },
    { project: 'alpha', limit: '1.5' },
  ]) {
    expect(() => occurrenceQueryInput(options, {})).toThrow();
  }
});

it('rejects repeated state flags before opening a database', async () => {
  await expect(
    createProgram().parseAsync(
      [
        'occurrence',
        'list',
        '00000000-0000-4000-8000-000000000001',
        '--project',
        'alpha',
        '--state',
        'pending',
        '--state',
        'debt',
      ],
      { from: 'user' },
    ),
  ).rejects.toMatchObject({ code: 'commander.invalidArgument' });
});

it.each([
  ['recurrence', 'get', '00000000-0000-4000-8000-000000000001'],
  ['settings', 'get'],
  ['occurrence', 'complete', '00000000-0000-4000-8000-000000000001'],
])('rejects state on %s %s before database or stdin work', async (...command) => {
  await expect(
    createProgram().parseAsync([...command, '--project', 'alpha', '--state', 'pending'], {
      from: 'user',
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});
