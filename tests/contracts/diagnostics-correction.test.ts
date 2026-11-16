import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';

/** SC-002: every refusal is corrected only from its own `details`, then retried to success. */
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const migration = fileURLToPath(new URL('../../dist/migrate.js', import.meta.url));
let directory: string;
let env: NodeJS.ProcessEnv;

type Details = Record<string, unknown> & {
  suggestions?: string[];
  option?: string;
  hints?: { action: string; command?: string }[];
  missing?: { field: string; source: { command?: string } }[];
};
type Envelope = {
  ok: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  error?: { code: string; details: Details | null };
};

function run(args: string[], input?: Record<string, unknown>): Envelope {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    env,
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: 'utf8',
    timeout: 8000,
  });
  return JSON.parse((result.status === 0 ? result.stdout : result.stderr).trim()) as Envelope;
}

function details(envelope: Envelope): Details {
  expect(envelope.ok).toBe(false);
  return envelope.error?.details ?? expect.fail('refusal without details');
}

/** Reads a value the way the refusal's `source.command` says. */
function readSource(command: string | undefined): unknown {
  if (command === 'meta') return run(['meta', '--all-projects']).meta?.database_epoch;
  if (command === 'config get') return run(['config', 'get', '--project', 'demo']).data?.revision;
  if (command === 'settings get')
    return run(['settings', 'get', '--project', 'demo']).data?.revision;
  return undefined;
}

type Alternative = { discriminator?: string; allowed?: string[] };
function fillMissing(input: Record<string, unknown>, refusal: Details) {
  const next = { ...input };
  const issues = (refusal.issues ?? []) as { alternatives?: Alternative[] }[];
  for (const issue of issues)
    for (const alternative of issue.alternatives ?? [])
      if (alternative.discriminator && alternative.allowed?.[0])
        next[alternative.discriminator] = alternative.allowed[0];
  for (const entry of refusal.missing ?? [])
    next[entry.field] =
      entry.field === 'operation_id' ? randomUUID() : readSource(entry.source.command);
  return next;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ai-tasks-correction-'));
  env = {
    ...process.env,
    AI_TASKS_DB_PATH: join(directory, 'db.sqlite'),
    AI_TASKS_BACKUP_DIR: join(directory, 'backups'),
  };
  expect(spawnSync(process.execPath, [migration], { env }).status).toBe(0);
  const project = { slug: 'demo', name: 'Demo', emoji: '🧪' };
  const refused = details(run(['project', 'create', '--project', 'demo', '--input', '-'], project));
  expect(
    run(['project', 'create', '--project', 'demo', '--input', '-'], fillMissing(project, refused))
      .ok,
  ).toBe(true);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('a missing scope is fixed by the choose_scope hint', () => {
  expect(details(run(['task', 'list'])).hints?.[0]?.action).toBe('choose_scope');
  expect(run(['task', 'list', '--project', 'demo']).ok).toBe(true);
});

it('a mistyped command is fixed by its suggestion', () => {
  const [command] = details(run(['tsak', 'list', '--project', 'demo'])).suggestions ?? [];
  expect(run([String(command), 'list', '--project', 'demo']).ok).toBe(true);
});

it('a mistyped option is fixed by its suggestion', () => {
  const [option] = details(run(['task', 'list', '--projetc', 'demo'])).suggestions ?? [];
  expect(run(['task', 'list', String(option), 'demo']).ok).toBe(true);
});

it('missing revision values are read from the named commands', () => {
  const task = { title: 'First task' };
  const refused = details(run(['task', 'create', '--project', 'demo', '--input', '-'], task));
  let input = fillMissing(task, refused);
  let result = run(['task', 'create', '--project', 'demo', '--input', '-'], input);
  for (let attempt = 0; !result.ok && attempt < 3; attempt += 1) {
    input = fillMissing(input, details(result));
    result = run(['task', 'create', '--project', 'demo', '--input', '-'], input);
  }
  expect(result.ok).toBe(true);
});

it('an unsupported option is dropped using supported_options', () => {
  const list = run(['task', 'list', '--project', 'demo']);
  const items = (Array.isArray(list.data) ? list.data : (list.data?.items ?? [])) as {
    id: string;
  }[];
  const id = items[0]?.id ?? expect.fail('no task to read');
  const args = ['task', 'get', id, '--project', 'demo', '--cursor', 'x'];
  const refused = details(run(args));
  const supported = new Set((refused.supported_options as string[] | undefined) ?? []);
  expect(supported.has(String(refused.option))).toBe(false);
  expect(run(['task', 'get', id, '--project', 'demo']).ok).toBe(true);
});
