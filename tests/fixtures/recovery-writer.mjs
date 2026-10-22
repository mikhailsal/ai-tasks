import { openSync, constants, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setImmediate as yieldNow } from 'node:timers/promises';
import Database from 'better-sqlite3';

const databasePath = process.argv[2];
const lockPath = `${databasePath}.lock`;
const lockFd = openSync(
  lockPath,
  constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
  0o600,
);
const locked = spawnSync('flock', ['--shared', '--timeout', '5', '3'], {
  stdio: ['ignore', 'ignore', 'pipe', lockFd],
  timeout: 7000,
});
if (locked.error || locked.status !== 0)
  throw new Error('Could not acquire fixture writer shared lock');

const sqlite = new Database(databasePath, { timeout: 5000 });
process.on('message', async (message) => {
  if (message?.type === 'start') {
    const update = sqlite.transaction(() => {
      sqlite.prepare('UPDATE application_state SET read_revision=read_revision+1 WHERE id=1').run();
    });
    for (let index = 0; index < 2_000; index += 1) {
      update();
      if (index === 0) process.send?.({ type: 'writing' });
      if (index % 10 === 0) await yieldNow();
    }
    process.send?.({ type: 'complete' });
  } else if (message?.type === 'close') {
    sqlite.close();
    closeSync(lockFd);
    process.disconnect();
  }
});
process.send?.({ type: 'ready' });
