import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { registry } from '../../src/cli/registry/index.js';
import type { CommandDescriptor } from '../../src/cli/registry/types.js';
import { exampleProblems } from '../fixtures/help-checker.js';
import { availablePort } from '../fixtures/available-port.js';
import { buildFixture } from '../fixtures/help-fixtures.js';
import { resolveExample } from '../fixtures/help-runner.js';

/** Every help example runs on its named fixture, with placeholders read from their sources. */
const directories: string[] = [];
afterAll(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
});

async function fixtureFor(descriptor: CommandDescriptor) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-help-example-'));
  directories.push(directory);
  return buildFixture(descriptor.example.fixture, directory);
}

/** `serve` runs until it reports readiness, then stops. */
async function serveReady(descriptor: CommandDescriptor, env: NodeJS.ProcessEnv): Promise<unknown> {
  const { argv } = resolveExample(descriptor, env);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../dist/cli.js', import.meta.url)), ...argv],
    {
      env: { ...env, AI_TASKS_PORT: String(await availablePort()) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const line = await new Promise<string>((resolve, reject) => {
      child.stdout.once('data', (chunk: Buffer) => resolve(chunk.toString().split('\n')[0] ?? ''));
      child.once('exit', (code) => reject(new Error(`serve exited with ${String(code)}`)));
    });
    return JSON.parse(line);
  } finally {
    child.kill('SIGTERM');
  }
}

const shard = Number(process.env.HELP_EXAMPLE_SHARD ?? '-1');
describe.each(registry.filter((_, index) => shard < 0 || index % 2 === shard))(
  '$path',
  (descriptor) => {
    it('example succeeds and its revision and field claims hold', async () => {
      const env = await fixtureFor(descriptor);
      if (descriptor.path[0] === 'serve') {
        expect(await serveReady(descriptor, env)).toMatchObject({ ok: true });
        return;
      }
      expect(await exampleProblems(descriptor, env)).toEqual([]);
    }, 90_000);
  },
);
