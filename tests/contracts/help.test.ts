import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createProgram } from '../../src/cli/main.js';
import { flagName } from '../../src/cli/registry/describe.js';
import { registry } from '../../src/cli/registry/index.js';
import { coverageProblems } from '../fixtures/help-checker.js';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const noDatabase = {
  ...process.env,
  AI_TASKS_DB_PATH: join(tmpdir(), `ai-tasks-missing-${randomUUID()}`, 'none.sqlite'),
};

function run(args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    env: noDatabase,
    encoding: 'utf8',
    timeout: 8000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
function json(args: string[]) {
  const result = run([...args, '--json']);
  return {
    status: result.status,
    body: JSON.parse((result.status === 0 ? result.stdout : result.stderr).trim()) as Record<
      string,
      unknown
    >,
  };
}

describe('help --json (spec 005 contracts/help.md)', () => {
  it('every Commander leaf has exactly one descriptor', () => {
    expect(coverageProblems(createProgram(), registry)).toEqual([]);
    const paths = registry.map((entry) => entry.path.join(' '));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('a leaf lists fields, revision values with sources and an example, without a database', () => {
    const { status, body } = json(['help', 'occurrence', 'complete']);
    expect(status).toBe(0);
    expect(body).not.toHaveProperty('meta');
    expect(body.data).toMatchObject({
      command: 'occurrence complete',
      kind: 'mutation',
      scope: 'project',
      positional: [{ name: 'task-id' }],
      input_forms: { forms: ['--input FILE', '--input -', 'options'], equivalent: true },
      fields: expect.arrayContaining([
        expect.objectContaining({
          name: 'occurrences[].id',
          type: 'uuid',
          required: true,
          repeats: true,
        }),
      ]),
      revisions: expect.arrayContaining([
        expect.objectContaining({
          field: 'expected_settings_revision',
          source: expect.objectContaining({ command: 'settings get' }),
        }),
      ]),
      example: expect.objectContaining({
        argv: expect.arrayContaining(['occurrence', 'complete']),
      }),
    });
  });

  it('the index groups every command by family, and a family lists its members', () => {
    const index = json(['help']).body.data as {
      help: string;
      commands: { family: string; commands: { command: string }[] }[];
    };
    expect(index.help).toContain('Usage: ai-tasks');
    expect(index.commands.flatMap((group) => group.commands.map((entry) => entry.command))).toEqual(
      registry.map((entry) => entry.path.join(' ')),
    );
    expect(json(['help', 'task']).body.data).toMatchObject({
      command: 'task',
      members: expect.arrayContaining([expect.objectContaining({ command: 'task create' })]),
    });
  });

  it('an unknown name is refused with suggestions, never another command help', () => {
    const { status, body } = json(['help', 'occurrence', 'compelte']);
    expect(status).toBe(2);
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        details: { names: ['compelte'], suggestions: ['complete'] },
      },
    });
  });

  it('is deterministic and refuses options other than --json', () => {
    expect(run(['help', 'task', 'create', '--json']).stdout).toBe(
      run(['help', 'task', 'create', '--json']).stdout,
    );
    expect(json(['help', 'task', '--project', 'demo']).body).toMatchObject({
      error: { details: { option: '--project', supported_options: ['--json'] } },
    });
  });

  it('human help is byte-identical to the previous build', () => {
    const sections = [
      'task --help',
      'task create --help',
      'occurrence complete --help',
      'backup status --help',
    ];
    const text = [
      `### help\n${run(['help']).stdout}`,
      ...sections.map((section) => `### ${section}\n${run(section.split(' ')).stdout}`),
    ].join('');
    expect(text).toBe(
      readFileSync(new URL('../fixtures/help-human-snapshot.txt', import.meta.url), 'utf8'),
    );
  });

  it('each command accepts exactly the options its descriptor lists', () => {
    const probes = ['cursor', 'limit', 'q', 'state', 'emoji', 'entityId', 'wait'] as const;
    for (const descriptor of registry) {
      const probe = probes.find((key) => !descriptor.options.includes(key));
      if (!probe) continue;
      const flag = flagName(probe);
      const args = [
        ...descriptor.path,
        ...(descriptor.positional ?? [])
          .filter((entry) => !entry.name.endsWith('...'))
          .map(() => randomUUID()),
        ...(probe === 'wait' ? [flag] : [flag, '1']),
        '--json',
      ];
      const result = run(args);
      const body = JSON.parse(result.stderr.trim() || '{}') as {
        error?: { details?: { supported_options?: string[] } };
      };
      expect({
        command: descriptor.path.join(' '),
        supported: body.error?.details?.supported_options,
      }).toEqual({
        command: descriptor.path.join(' '),
        supported: descriptor.options.map(flagName).sort(),
      });
    }
  }, 60_000);
});

describe('help and refusals tell the same story (spec 005 US4)', () => {
  it('a refusal names the same sources as the help', () => {
    for (const path of [
      ['occurrence', 'complete'],
      ['task', 'update'],
      ['config', 'migrate'],
    ]) {
      const help = json(['help', ...path]).body.data as {
        revisions: { field: string; source: unknown }[];
      };
      const directory = join(tmpdir(), `ai-tasks-help-${randomUUID()}`);
      const result = spawnSync(
        process.execPath,
        [
          cli,
          ...path,
          ...(path[0] === 'config' ? [] : [randomUUID()]),
          '--project',
          'demo',
          '--input',
          '-',
          '--json',
        ],
        {
          env: { ...noDatabase, AI_TASKS_DB_PATH: join(directory, 'none.sqlite') },
          input: '{}',
          encoding: 'utf8',
        },
      );
      const refusal = JSON.parse(result.stderr.trim()) as {
        error: { details: { missing: { field: string; source: unknown }[] } };
      };
      for (const entry of refusal.error.details.missing)
        expect(help.revisions.find((revision) => revision.field === entry.field)?.source).toEqual(
          entry.source,
        );
    }
  });
});
