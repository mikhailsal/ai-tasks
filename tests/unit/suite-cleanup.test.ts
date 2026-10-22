import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { z } from 'zod/mini';
const runner = fileURLToPath(new URL('../../scripts/run-suite.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/suite-tree.mjs', import.meta.url));
const identitySchema = z.object({ pid: z.int().check(z.positive()), startTime: z.string() });
const treeSchema = z.object({
  type: z.literal('ready'),
  leader: identitySchema,
  descendant: identitySchema,
});
type Identity = z.output<typeof identitySchema>;
function running(identity: Identity) {
  try {
    const stat = readFileSync(`/proc/${identity.pid}/stat`, 'utf8');
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/u);
    return fields[19] === identity.startTime && fields[0] !== 'Z' && fields[0] !== 'X';
  } catch {
    return false;
  }
}
function killKnown(identity: Identity | undefined) {
  if (identity && running(identity)) process.kill(identity.pid, 'SIGKILL');
}
function ready(child: ChildProcess) {
  return new Promise<z.output<typeof treeSchema>>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error(`Suite fixture readiness timeout: ${output}`)),
      3500,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      for (const line of output.split('\n')) {
        try {
          const parsed = treeSchema.safeParse(JSON.parse(line));
          if (parsed.success) {
            clearTimeout(timer);
            resolve(parsed.data);
          }
        } catch {
          /* An incomplete line is completed by the next stdout chunk. */
        }
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
function exited(child: ChildProcess) {
  return new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Suite runner did not exit within 6 seconds')),
      6000,
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}
it.each(['interrupt', 'completion', 'quick-completion'] as const)(
  'cleans its detached descendant after %s without changing suite evidence/budget',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-suite-cleanup-'));
    const unrelated = spawn(process.execPath, [fixture, 'unrelated'], {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const unrelatedCompletion = exited(unrelated);
    const unrelatedIdentity = (await ready(unrelated)).leader;
    const child = spawn(
      process.execPath,
      [
        runner,
        'functional',
        '--',
        process.execPath,
        fixture,
        ...(mode === 'quick-completion' ? ['quick'] : []),
      ],
      {
        cwd: directory,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const completion = exited(child);
    let tree: z.output<typeof treeSchema> | undefined;
    try {
      tree = await ready(child);
      if (mode !== 'quick-completion') expect(running(tree.descendant)).toBe(true);
      if (mode === 'interrupt') child.kill('SIGINT');
      else if (mode === 'completion') process.kill(tree.leader.pid, 'SIGUSR1');
      const result = await completion;
      expect(result.code === 0).toBe(mode !== 'interrupt');
      expect(running(unrelatedIdentity)).toBe(true);
      expect(running(tree.descendant), `Leaked detached descendant ${tree.descendant.pid}`).toBe(
        false,
      );
      const evidenceDirectory = join(directory, 'artifacts/checks');
      const entries = await readdir(evidenceDirectory);
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      if (!entry) throw new Error('Missing suite evidence');
      expect(JSON.parse(await readFile(join(evidenceDirectory, entry), 'utf8'))).toMatchObject({
        suite: 'functional',
        budget_ms: 180000,
        timed_out: false,
        exit_code: result.code,
        platform: 'linux',
      });
    } finally {
      killKnown(unrelatedIdentity);
      await unrelatedCompletion.catch(() => {});
      killKnown(tree?.descendant);
      killKnown(tree?.leader);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await completion.catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  },
);
