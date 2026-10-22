import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createProgram } from '../../src/cli/main.js';
import { backupStatusInput } from '../../src/cli/commands/backups.js';
import { commandOptions } from '../../src/cli/options.js';
import { decodeStandaloneCommand } from '../../src/core/recovery/standalone.js';

it('registers exactly the five documented backup commands, with no-wait local to restore', async () => {
  const program = createProgram();
  const family = program.commands.find((command) => command.name() === 'backup');
  expect(family?.commands.map((command) => command.name())).toEqual([
    'list',
    'create',
    'validate',
    'restore',
    'status',
  ]);
  const restore = family?.commands.find((command) => command.name() === 'restore');
  if (!restore) throw new Error('Missing restore command');
  let flags: unknown;
  restore.action(() => {
    flags = commandOptions(restore);
  });
  await program.parseAsync(['backup', 'restore', '--no-wait', '--project', 'alpha', '--json'], {
    from: 'user',
  });
  expect(flags).toEqual({ wait: false, project: 'alpha', json: true });
  expect(program.opts()).not.toHaveProperty('wait');
  expect(
    family?.commands
      .find((command) => command.name() === 'create')
      ?.options.some((option) => option.long === '--no-wait'),
  ).toBe(false);
});

it('default restore waits, while no-wait is rejected on other commands', async () => {
  const program = createProgram();
  const restore = program.commands
    .find((command) => command.name() === 'backup')
    ?.commands.find((command) => command.name() === 'restore');
  if (!restore) throw new Error('Missing restore command');
  let flags: unknown;
  restore.action(() => {
    flags = commandOptions(restore);
  });
  await program.parseAsync(['backup', 'restore', '--project', 'alpha'], { from: 'user' });
  expect(flags).toEqual({ wait: true, project: 'alpha' });
  await expect(
    createProgram().parseAsync(['backup', 'list', '--all-projects', '--no-wait'], { from: 'user' }),
  ).rejects.toThrow();
  await expect(
    createProgram().parseAsync(['backup', 'restore', '--no-wait', '--no-wait'], { from: 'user' }),
  ).rejects.toThrow();
});

it('status maps a UUID lookup from flags or JSON without requiring database access', () => {
  const id = randomUUID();
  expect(backupStatusInput({ allProjects: true }, {}, id)).toEqual({
    all_projects: true,
    job_id: id,
  });
  expect(backupStatusInput({ allProjects: true, operationId: id }, {})).toEqual({
    all_projects: true,
    operation_id: id,
  });
  expect(backupStatusInput({ allProjects: true }, { operation_id: id })).toEqual({
    all_projects: true,
    operation_id: id,
  });
});

it('status rejects duplicated/XOR/missing/foreign-scope/unknown keys before reading manifests', () => {
  const id = randomUUID();
  for (const read of [
    () => backupStatusInput({ allProjects: true, operationId: id }, { operation_id: id }),
    () => backupStatusInput({ allProjects: true }, { job_id: id }, id),
    () => backupStatusInput({ allProjects: true, operationId: id }, {}, id),
    () => backupStatusInput({ allProjects: true }, {}),
    () => backupStatusInput({ project: 'alpha' }, {}, id),
    () => backupStatusInput({}, {}, id),
    () => backupStatusInput({ allProjects: true }, { operation_id: 'invalid' }),
    () =>
      backupStatusInput(
        { allProjects: true },
        JSON.parse(`{"operation_id":"${id}","__proto__":"hidden"}`),
      ),
  ])
    expect(read).toThrow();
});

it('the detached owner accepts only original CLI restore commands, never an injected accepted job', () => {
  const command = {
    operation: 'restore',
    databasePath: '/tmp/live.sqlite',
    projectSlug: 'alpha',
    actor: 'ai-cli:alpha',
    envelope: { operation_id: randomUUID(), database_epoch: randomUUID(), payload: {} },
  };
  expect(decodeStandaloneCommand(command)).toEqual(command);
  expect(() => decodeStandaloneCommand({ ...command, actor: 'human-web' })).toThrow();
  expect(() => decodeStandaloneCommand({ ...command, jobId: randomUUID() })).toThrow();
  expect(() =>
    decodeStandaloneCommand({ ...command, failpoint: 'publish.after_replace' }),
  ).toThrow();
});
