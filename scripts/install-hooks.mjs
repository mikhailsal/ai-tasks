import { spawnSync } from 'node:child_process';
import { accessSync, constants, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}
function requireGit(...args) {
  const result = git(...args);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}
function canonical(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return resolve(path);
    throw error;
  }
}

try {
  const root = requireGit('rev-parse', '--show-toplevel');
  const configured = git('config', '--path', '--get', 'core.hooksPath');
  if (configured.status === 0) {
    if (
      canonical(resolve(root, configured.stdout.trim())) !== canonical(resolve(root, '.githooks'))
    ) {
      throw new Error(
        `core.hooksPath already points to ${configured.stdout.trim()}; preserve or migrate those hooks before installing.`,
      );
    }
    console.log('Hooks are already installed.');
  } else {
    if (configured.status !== 1)
      throw new Error(configured.stderr.trim() || 'Unable to read core.hooksPath.');
    const hooksDir = resolve(root, requireGit('rev-parse', '--git-path', 'hooks'));
    let entries;
    try {
      entries = readdirSync(hooksDir);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries = [];
    }
    for (const entry of entries) {
      if (entry.endsWith('.sample')) continue;
      try {
        accessSync(resolve(hooksDir, entry), constants.X_OK);
      } catch (error) {
        if (error.code === 'EACCES' || error.code === 'ENOENT') continue;
        throw error;
      }
      throw new Error(
        `Active default hook found at ${resolve(hooksDir, entry)}; preserve or migrate it before installing.`,
      );
    }
    const worktrees = requireGit('worktree', 'list', '--porcelain');
    if ((worktrees.match(/^worktree /gm) || []).length > 1) {
      throw new Error(
        'Multiple worktrees share Git configuration; configure hooks for them explicitly before installing.',
      );
    }
    requireGit('config', '--local', 'core.hooksPath', '.githooks');
    console.log('Installed hooks from .githooks.');
  }
} catch (error) {
  console.error(`hooks:install: ${error.message}`);
  process.exitCode = 1;
}
