import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Runs the README first-task block as written on its own scratch database (spec 004 FR-001). */
export async function validateReadmeFirstTask() {
  const readme = await readFile('README.md', 'utf8');
  const section = readme.split('Then five commands')[1] ?? '';
  const block = /```bash\n([\s\S]*?)```/u.exec(section)?.[1];
  assert.ok(block, 'README first-task block is missing');
  const commands = block.split('\n').filter((line) => line.trim() !== '');
  assert.ok(commands.length <= 5, 'README first-task path exceeds five commands');
  const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-readme-'));
  try {
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', block], {
      env: {
        ...process.env,
        AI_TASKS_DB_PATH: join(directory, 'ai-tasks.sqlite'),
        AI_TASKS_BACKUP_DIR: join(directory, 'backups'),
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const last = result.stdout.trim().split('\n').at(-1) ?? '';
    const listed = JSON.parse(last);
    assert.equal(listed.ok, true);
    assert.ok(JSON.stringify(listed.data).includes('First task'), 'created task is not listed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return 'README first-task path (five commands, scratch database)';
}
