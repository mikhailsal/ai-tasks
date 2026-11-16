import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const migration = fileURLToPath(new URL('../../dist/migrate.js', import.meta.url));
let directory: string;
let env: NodeJS.ProcessEnv;
let epoch: string;

type Envelope = {
  ok: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details: Record<string, unknown> | null };
};

function run(args: string[], input?: unknown, environment = env) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    env: environment,
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: 'utf8',
    timeout: 8000,
  });
  const text = result.status === 0 ? result.stdout : result.stderr;
  return { status: result.status, body: JSON.parse(text.trim()) as Envelope };
}

function refusal(args: string[], input?: unknown, environment = env) {
  const result = run(args, input, environment);
  expect(result.body.ok).toBe(false);
  return { status: result.status, error: result.body.error ?? expect.fail('no error') };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ai-tasks-diagnostics-'));
  env = {
    ...process.env,
    AI_TASKS_DB_PATH: join(directory, 'db.sqlite'),
    AI_TASKS_BACKUP_DIR: join(directory, 'backups'),
  };
  const migrated = spawnSync(process.execPath, [migration], { env, encoding: 'utf8' });
  expect(migrated.status).toBe(0);
  epoch = String(run(['meta', '--all-projects']).body.meta?.database_epoch);
  const created = run(['project', 'create', '--project', 'demo', '--input', '-'], {
    operation_id: randomUUID(),
    database_epoch: epoch,
    slug: 'demo',
    name: 'Demo',
    emoji: '🧪',
  });
  expect(created.body.ok).toBe(true);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('CLI refusals name the fix (spec 004 contracts/diagnostics.md)', () => {
  it('a read without scope names both choices and keeps issues', () => {
    const { status, error } = refusal(['task', 'list']);
    expect(status).toBe(2);
    expect(error.message).toBe('Choose a read scope: --project SLUG or --all-projects');
    expect(error.details).toMatchObject({
      issues: expect.any(Array),
      hints: [{ action: 'choose_scope', text: 'Use --project or --all-projects' }],
    });
  });

  it('unknown command and option names come with nearest suggestions', () => {
    expect(refusal(['tsak', 'list']).error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Unknown command tsak. Did you mean task?',
      details: { names: ['tsak'], names_omitted: 0, suggestions: ['task'] },
    });
    expect(refusal(['task', 'lsit']).error.details).toMatchObject({ suggestions: ['list'] });
    expect(
      refusal(['task', 'list', '--project', 'demo', '--expected-revison', '1']).error,
    ).toMatchObject({
      message: 'Unknown option --expected-revison. Did you mean --expected-revision?',
      details: { suggestions: ['--expected-revision'] },
    });
    expect(refusal(['zzz']).error.details).toMatchObject({ names: ['zzz'], suggestions: [] });
  });

  it('an unsafe name is never echoed', () => {
    const { error } = refusal(['TASK<script>']);
    expect(JSON.stringify(error)).not.toContain('script');
    expect(error.details).toMatchObject({ names: [], names_omitted: 1 });
  });

  it('an unsupported option names the option and the supported ones', () => {
    const id = randomUUID();
    expect(refusal(['task', 'get', id, '--project', 'demo', '--cursor', 'x']).error).toMatchObject({
      message: 'Option --cursor is not supported by this command',
      details: { option: '--cursor', supported_options: expect.arrayContaining(['--project']) },
    });
  });

  it('missing revision values are all listed with where to read them', () => {
    const missingTokens = refusal(['task', 'create', '--project', 'demo', '--input', '-'], {
      title: 'x',
    }).error;
    expect(missingTokens.message).toBe(
      'Missing required values: operation_id, database_epoch (meta)',
    );
    expect(missingTokens.details).toMatchObject({
      field: 'operation_id',
      missing: [
        { field: 'operation_id' },
        { field: 'database_epoch', source: { command: 'meta' } },
      ],
    });
    const recurring = refusal(['task', 'create', '--project', 'demo', '--input', '-'], {
      operation_id: randomUUID(),
      database_epoch: epoch,
      title: 'x',
      kind: 'recurring',
    }).error;
    expect(recurring.message).toBe(
      'Missing required values: expected_config_revision (config get), expected_settings_revision (settings get)',
    );
    expect(recurring.details).toMatchObject({
      field: 'expected_config_revision',
      missing: [
        { field: 'expected_config_revision', source: { command: 'config get' } },
        { field: 'expected_settings_revision', source: { command: 'settings get' } },
      ],
    });
  });

  it('a value outside a fixed set lists the allowed values', () => {
    const config = run(['config', 'get', '--project', 'demo']).body.data;
    const { error } = refusal(['task', 'create', '--project', 'demo', '--input', '-'], {
      operation_id: randomUUID(),
      database_epoch: epoch,
      expected_config_revision: config?.revision,
      title: 'x',
      kind: 'sometimes',
    });
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(error.details)).toMatch(/"(allowed|alternatives)"/u);
  });

  it('a missing database names how its location is chosen and the next step', () => {
    const { status, error } = refusal(['task', 'list', '--project', 'demo'], undefined, {
      ...env,
      AI_TASKS_DB_PATH: join(directory, 'absent', 'none.sqlite'),
    });
    expect(status).toBe(1);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).toContain('AI_TASKS_DB_PATH');
    expect(error.message).not.toContain(directory);
    expect(error.details).toMatchObject({
      location: 'AI_TASKS_DB_PATH',
      default_path: 'data/ai-tasks.sqlite',
      hints: [{ action: 'run_migration' }],
    });
  });
});
