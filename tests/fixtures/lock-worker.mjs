import { fork } from 'node:child_process';
import { readdirSync, readlinkSync } from 'node:fs';

const descendants = new Set();
let lock;
let runtime;

function send(message) {
  if (process.connected) process.send(message);
}

function descriptorsFor(lockPath) {
  return readdirSync('/proc/self/fd').filter((fd) => {
    try {
      return readlinkSync(`/proc/self/fd/${fd}`) === lockPath;
    } catch {
      return false;
    }
  });
}

process.on('message', async (message) => {
  try {
    if (message.type === 'acquire') {
      runtime ??= await import('../../dist/database-lock.js');
      send({ type: 'acquiring' });
      lock = runtime.acquireDatabaseLock({
        databasePath: message.databasePath,
        mode: message.mode,
        timeoutSeconds: message.timeoutSeconds ?? 0,
      });
      send({ type: 'acquired', mode: lock.mode, lockPath: lock.lockPath });
    } else if (message.type === 'release') {
      runtime.releaseDatabaseLock(lock);
      lock = undefined;
      send({ type: 'released' });
    } else if (message.type === 'spawn-descendant') {
      const descendant = fork(new URL(import.meta.url), ['--descendant'], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        execArgv: [],
      });
      descendants.add(descendant);
      descendant.on('message', (event) => {
        if (event.type === 'ready') {
          descendant.send({ type: 'inspect', lockPath: message.lockPath });
        } else if (event.type === 'inspected') {
          send({ type: 'descendant-ready', descriptors: event.descriptors });
        } else if (event.type === 'pong') {
          send({ type: 'descendant-pong' });
        }
      });
    } else if (message.type === 'ping-descendant') {
      for (const descendant of descendants) descendant.send({ type: 'ping' });
    } else if (message.type === 'inspect') {
      send({ type: 'inspected', descriptors: descriptorsFor(message.lockPath) });
    } else if (message.type === 'ping') {
      send({ type: 'pong' });
    } else if (message.type === 'shutdown') {
      if (lock) runtime.releaseDatabaseLock(lock);
      for (const descendant of descendants) descendant.kill('SIGKILL');
      process.exit(0);
    }
  } catch (error) {
    send({ type: 'failed', code: error.code, message: error.message });
  }
});

process.on('disconnect', () => {
  for (const descendant of descendants) descendant.kill('SIGKILL');
  process.exit(0);
});
send({ type: 'ready' });
