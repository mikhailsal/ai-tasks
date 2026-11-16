import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterAll, expect, it } from 'vitest';
import { findDescriptor } from '../../src/cli/registry/index.js';
import type { CommandDescriptor } from '../../src/cli/registry/types.js';
import { coverageProblems, exampleProblems } from '../fixtures/help-checker.js';
import { buildFixture } from '../fixtures/help-fixtures.js';

/** SC-002: the checker reports deliberately broken descriptors. */
const directories: string[] = [];
afterAll(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
});
async function problems(descriptor: CommandDescriptor) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-help-fault-'));
  directories.push(directory);
  return exampleProblems(descriptor, buildFixture(descriptor.example.fixture, directory));
}
function base(): CommandDescriptor {
  const descriptor = findDescriptor(['occurrence', 'complete']);
  if (!descriptor) throw new Error('occurrence complete has no descriptor');
  return descriptor;
}

it('reports a command without a descriptor and a descriptor without a command', () => {
  const program = new Command('ai-tasks');
  program.command('ghost');
  expect(coverageProblems(program, [{ ...base(), path: ['phantom'] }])).toEqual([
    'no descriptor: ghost',
    'no command: phantom',
  ]);
});

it('reports a missing revision value (help lists fewer values than the guard needs)', async () => {
  const broken = { ...base(), mutation: 'occurrence.cancel' as const };
  expect((await problems(broken)).join('\n')).toContain('example failed');
}, 90_000);

it('reports an extra revision value (help lists one the guard does not need)', async () => {
  const cancel = findDescriptor(['occurrence', 'cancel']);
  if (!cancel) throw new Error('occurrence cancel has no descriptor');
  const broken: CommandDescriptor = {
    ...cancel,
    mutation: 'occurrence.complete',
    example: {
      ...cancel.example,
      input: { ...cancel.example.input, expected_settings_revision: '{{settings_revision}}' },
      placeholders: {
        ...cancel.example.placeholders,
        settings_revision: { command: 'settings get', path: 'data.revision' },
      },
    },
  };
  expect((await problems(broken)).join('\n')).toContain(
    'dropping expected_settings_revision was not refused',
  );
}, 90_000);

it('reports a renamed field and a broken example', async () => {
  const original = base();
  const renamed: CommandDescriptor = {
    ...original,
    example: {
      ...original.example,
      input: { ...original.example.input, occurrences: undefined, occurrence: [] },
    },
  };
  expect((await problems(renamed)).join('\n')).toContain('example failed');
  const wrongFixture: CommandDescriptor = {
    ...original,
    example: { ...original.example, fixture: 'empty_project' },
  };
  await expect(problems(wrongFixture)).rejects.toThrow(/placeholder/u);
}, 90_000);
