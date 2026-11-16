import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const source = resolve(import.meta.dirname, '../..');
const fixtures: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hooks-test-'));
  fixtures.push(root);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  const env = {
    ...inherited,
    npm_config_userconfig: join(root, 'npmrc'),
    npm_config_globalconfig: join(root, 'npm-global'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'global'),
  };
  const run = (command: string, args: string[]) =>
    spawnSync(command, args, { cwd: repo, env, encoding: 'utf8' });
  expect(run('git', ['init', '-q']).status).toBe(0);
  cpSync(join(source, 'package.json'), join(repo, 'package.json'));
  mkdirSync(join(repo, 'scripts'));
  cpSync(join(source, 'scripts/install-hooks.mjs'), join(repo, 'scripts/install-hooks.mjs'));
  mkdirSync(join(repo, '.githooks'));
  return { root, repo, env, run, install: () => run('npm', ['run', '--silent', 'hooks:install']) };
}
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('installs into a clean repository and permits repeated installation', () => {
  const f = fixture();
  expect(f.install().status).toBe(0);
  expect(f.install().status).toBe(0);
  expect(f.run('git', ['config', '--local', '--get', 'core.hooksPath']).stdout.trim()).toBe(
    '.githooks',
  );
});
it.each(['local', 'global'])('preserves a conflicting %s hooks path', (scope) => {
  const f = fixture();
  expect(f.run('git', ['config', `--${scope}`, 'core.hooksPath', 'existing-hooks']).status).toBe(0);
  const result = f.install();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/hook/i);
  expect(f.run('git', ['config', '--get', 'core.hooksPath']).stdout.trim()).toBe('existing-hooks');
});
it('preserves active default hooks', () => {
  const f = fixture();
  const hook = join(f.repo, '.git/hooks/pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const result = f.install();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/hook/i);
  expect(f.run('git', ['config', '--get', 'core.hooksPath']).status).toBe(1);
  expect(readFileSync(hook, 'utf8')).toContain('exit 0');
});
it('leaves configuration alone when Git cannot read it', () => {
  const f = fixture();
  writeFileSync(join(f.root, 'global'), '[broken\n');
  const result = f.install();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/config|bad/i);
  expect(readFileSync(join(f.root, 'global'), 'utf8')).toBe('[broken\n');
});
it('does not change shared configuration with multiple worktrees', () => {
  const f = fixture();
  expect(
    f.run('git', [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-qm',
      'initial',
    ]).status,
  ).toBe(0);
  expect(f.run('git', ['worktree', 'add', '--detach', join(f.root, 'other')]).status).toBe(0);
  const result = f.install();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/worktree/i);
  expect(f.run('git', ['config', '--get', 'core.hooksPath']).status).toBe(1);
});
it('accepts an existing equivalent symlinked path', () => {
  const f = fixture();
  symlinkSync('.githooks', join(f.repo, 'hook-link'));
  f.run('git', ['config', '--local', 'core.hooksPath', 'hook-link']);
  expect(f.install().status).toBe(0);
  expect(f.run('git', ['config', '--get', 'core.hooksPath']).stdout.trim()).toBe('hook-link');
});
it('fails before npm checks when shellcheck is missing', () => {
  const f = fixture();
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  symlinkSync('/usr/bin/git', join(bin, 'git'));
  const npm = join(bin, 'npm');
  writeFileSync(npm, `#!/bin/sh\n/usr/bin/touch '${join(f.root, 'npm-ran')}'\n`, { mode: 0o755 });
  chmodSync(npm, 0o755);
  const result = spawnSync('/bin/bash', [join(source, '.githooks/pre-push')], {
    cwd: f.repo,
    env: { ...f.env, PATH: bin },
    encoding: 'utf8',
    input: '',
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/shellcheck/i);
  expect(result.stderr).toMatch(/install/i);
  expect(existsSync(join(f.root, 'npm-ran'))).toBe(false);
});

it('rejects main before checking for shellcheck', () => {
  const f = fixture();
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  const result = spawnSync('/bin/bash', [join(source, '.githooks/pre-push')], {
    cwd: f.repo,
    env: { ...f.env, PATH: bin },
    encoding: 'utf8',
    input: 'refs/heads/topic abc refs/heads/main def\n',
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/direct pushes to main are not allowed/i);
  expect(result.stderr).not.toMatch(/shellcheck/i);
});
