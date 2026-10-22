import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const databasePath = process.argv[2];
const commands = JSON.parse(process.argv[3] ?? 'null');
const workerId = Number(process.env.AI_TASKS_WORKER_ID);
const command = commands?.[workerId];
if (!databasePath || !command) throw new Error('Missing real contention command');
const helper = fork(fileURLToPath(new URL('../../dist/data-helper.js', import.meta.url)), [], {
  env: { ...process.env, AI_TASKS_DB_PATH: databasePath },
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  execArgv: [],
});
let requestId;
let started;
let closing = false;
let escalation;
function send(message) {
  if (process.connected) process.send?.(message);
}
function shutdown() {
  if (closing) return;
  closing = true;
  if (helper.exitCode !== null || helper.signalCode !== null) {
    process.exit(0);
    return;
  }
  if (helper.connected) helper.send({ type: 'shutdown' }, () => {});
  else helper.kill('SIGTERM');
  escalation = setTimeout(() => helper.kill('SIGKILL'), 100);
}
helper.on('message', (message) => {
  if (message.type === 'ready')
    send({ type: 'ready', workerPid: process.pid, helperPid: helper.pid });
  if (message.type === 'fatal') send({ type: 'failed', envelope: message.error });
  if (message.type === 'response' && message.id === requestId)
    send({
      type: 'result',
      workerId,
      workerPid: process.pid,
      helperPid: helper.pid,
      elapsedMs: performance.now() - started,
      envelope: message.envelope,
    });
});
helper.on('error', (error) => send({ type: 'failed', message: error.message }));
helper.on('exit', (code) => {
  clearTimeout(escalation);
  if (closing) process.exit(0);
  else {
    send({ type: 'failed', message: `Production helper exited: ${code}` });
    process.exitCode = 1;
  }
});
process.on('message', (message) => {
  if (message?.type === 'shutdown') {
    shutdown();
    return;
  }
  if (message?.type !== 'release' || requestId) return;
  requestId = randomUUID();
  started = performance.now();
  helper.send({ type: 'request', id: requestId, ...command });
  send({ type: 'dispatched', helperPid: helper.pid });
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('disconnect', () => {
  if (helper.exitCode === null && helper.signalCode === null) helper.kill('SIGKILL');
  process.exit(0);
});
